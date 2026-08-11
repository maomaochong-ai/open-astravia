import type {
	ModelCallFrameCompositionContext,
	RuntimeToolDefinition,
	RuntimeToolExecutionRequest,
	RuntimeToolResult,
} from "@vetta/runtime-core/kernel";
import type { ContributionRegistration, DynamicContributionCatalog } from "../contribution-catalog.js";
import type { CodingAgentToolInterceptor, ToolInterceptionAfterResult, ToolInterceptionContext } from "./contracts.js";

export function wrapRuntimeToolsWithInterceptionPipeline(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	catalog: DynamicContributionCatalog<CodingAgentToolInterceptor>,
	frameContext?: ModelCallFrameCompositionContext,
): ReadonlyMap<string, RuntimeToolDefinition> {
	return new Map(
		[...tools].map(([name, tool]) => [name, wrapRuntimeToolWithInterceptionPipeline(tool, catalog, frameContext)]),
	);
}

function wrapRuntimeToolWithInterceptionPipeline(
	tool: RuntimeToolDefinition,
	catalog: DynamicContributionCatalog<CodingAgentToolInterceptor>,
	frameContext: ModelCallFrameCompositionContext | undefined,
): RuntimeToolDefinition {
	return {
		...tool,
		execute: (request) => executeInterceptionSnapshot(tool, request, catalog.snapshot(), frameContext),
	};
}

async function executeInterceptionSnapshot(
	tool: RuntimeToolDefinition,
	request: RuntimeToolExecutionRequest,
	interceptors: readonly ContributionRegistration<CodingAgentToolInterceptor>[],
	frameContext: ModelCallFrameCompositionContext | undefined,
): Promise<RuntimeToolResult> {
	return executeAt(0, request.input);

	async function executeAt(index: number, input: Readonly<Record<string, unknown>>): Promise<RuntimeToolResult> {
		const registration = interceptors[index];
		if (!registration) return tool.execute({ ...request, input });

		const context: ToolInterceptionContext = { tool, request, frameContext, input };
		const before = await registration.value.before?.(context);
		if (before?.block) throw new ToolInterceptionBlockedError(registration, before.block.reason);
		const effectiveInput = before?.input ?? input;
		const effectiveContext = { ...context, input: effectiveInput };
		let result: RuntimeToolResult;
		try {
			result = await executeAt(index + 1, effectiveInput);
		} catch (error) {
			throw await applyErrorInterceptor(registration, effectiveContext, before?.state, error);
		}

		let after: ToolInterceptionAfterResult | undefined;
		try {
			after = await registration.value.after?.({
				...effectiveContext,
				result,
				state: before?.state,
			});
		} catch (error) {
			throw await applyErrorInterceptor(registration, effectiveContext, before?.state, error);
		}
		if (after?.block) throw new ToolInterceptionBlockedError(registration, after.block.reason);
		return after?.result ?? result;
	}
}

async function applyErrorInterceptor(
	registration: ContributionRegistration<CodingAgentToolInterceptor>,
	context: ToolInterceptionContext,
	state: unknown,
	error: unknown,
): Promise<unknown> {
	const outcome = await registration.value.onError?.({ ...context, state, error });
	return outcome && "error" in outcome ? outcome.error : error;
}

export class ToolInterceptionBlockedError extends Error {
	readonly sourceId: string;
	readonly localId: string;

	constructor(registration: ContributionRegistration<CodingAgentToolInterceptor>, reason: string) {
		super(reason);
		this.name = "ToolInterceptionBlockedError";
		this.sourceId = registration.sourceId;
		this.localId = registration.localId;
	}
}
