import { McpInputRequiredError } from "@vetta/runtime-mcp/client";
import type {
	McpInputRequiredResult,
	McpInteractionContext,
	McpJsonObject,
	McpRequestOptions,
	McpServerInteractionHandlers,
} from "@vetta/runtime-mcp/protocol";
import { isMcpInputRequiredResult, resolveMcpInputRequests } from "@vetta/runtime-mcp/protocol";

export interface McpMrtrRequestOptions<T> {
	readonly serverName: string;
	readonly method: string;
	readonly initialFields: McpJsonObject;
	readonly requestOptions?: McpRequestOptions;
	readonly handlers?: McpServerInteractionHandlers;
	readonly maxRounds: number;
	readonly invoke: (fields: McpJsonObject, signal?: AbortSignal) => Promise<unknown>;
	readonly accept: (value: unknown) => value is T;
	readonly invalidResult: () => Error;
	readonly onRound?: (round: number) => void;
}

/** Runs the request–input–request loop shared by Modern HTTP and stdio transports. */
export async function runMcpMrtrRequest<T>(options: McpMrtrRequestOptions<T>): Promise<T> {
	let fields = options.initialFields;
	for (let round = 1; round <= options.maxRounds; round += 1) {
		throwIfAborted(options.requestOptions?.signal);
		const result = await options.invoke(fields, options.requestOptions?.signal);
		if (!isMcpInputRequiredResult(result)) {
			if (options.accept(result)) return result;
			throw options.invalidResult();
		}
		if (!options.handlers) throw new McpInputRequiredError(options.method, result);
		fields = await buildContinuationFields(fields, result, options.handlers, {
			serverName: options.serverName,
			method: options.method,
			round,
			signal: options.requestOptions?.signal,
			sessionId: options.requestOptions?.sessionId,
			turnId: options.requestOptions?.turnId,
			toolCallId: options.requestOptions?.toolCallId,
		});
		options.onRound?.(round);
	}
	throw new Error(`MCP interaction round limit exceeded: ${options.method} (${options.maxRounds})`);
}

async function buildContinuationFields(
	fields: McpJsonObject,
	result: McpInputRequiredResult,
	handlers: McpServerInteractionHandlers,
	context: McpInteractionContext,
): Promise<McpJsonObject> {
	const inputResponses = result.inputRequests
		? await resolveMcpInputRequests(result.inputRequests, handlers, context)
		: undefined;
	return {
		...fields,
		...(inputResponses ? { inputResponses } : {}),
		...(result.requestState ? { requestState: result.requestState } : {}),
	};
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException("MCP request aborted", "AbortError");
}
