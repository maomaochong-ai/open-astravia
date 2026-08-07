import type { RuntimeToolDefinition, RuntimeToolExecutionRequest, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { ExtensionRunner, ToolCallEventResult } from "../../extensions/index.js";

/** 在最终 Runtime Tool Frame 上保留 Extension 的 tool_call/tool_result 语义。 */
export function wrapRuntimeToolsWithExtensions(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	runner: Pick<ExtensionRunner, "hasHandlers" | "emitToolCall" | "emitToolResult">,
): ReadonlyMap<string, RuntimeToolDefinition> {
	return new Map([...tools].map(([name, tool]) => [name, wrapRuntimeToolWithExtensions(tool, runner)]));
}

function wrapRuntimeToolWithExtensions(
	tool: RuntimeToolDefinition,
	runner: Pick<ExtensionRunner, "hasHandlers" | "emitToolCall" | "emitToolResult">,
): RuntimeToolDefinition {
	return {
		...tool,
		execute: (request) => executeRuntimeToolWithExtensions(tool, runner, request),
	};
}

async function executeRuntimeToolWithExtensions(
	tool: RuntimeToolDefinition,
	runner: Pick<ExtensionRunner, "hasHandlers" | "emitToolCall" | "emitToolResult">,
	request: RuntimeToolExecutionRequest,
): Promise<RuntimeToolResult> {
	const input = { ...request.input };
	if (runner.hasHandlers("tool_call")) {
		try {
			const callResult = (await runner.emitToolCall({
				type: "tool_call",
				toolName: tool.name,
				toolCallId: request.toolCallId,
				input,
			})) as ToolCallEventResult | undefined;
			if (callResult?.block) {
				throw new Error(callResult.reason || "Tool execution was blocked by an extension");
			}
		} catch (error) {
			if (error instanceof Error) throw error;
			throw new Error(`Extension failed, blocking execution: ${String(error)}`);
		}
	}

	try {
		const result = await tool.execute(request);
		if (!runner.hasHandlers("tool_result")) return result;
		const transformed = await runner.emitToolResult({
			type: "tool_result",
			toolName: tool.name,
			toolCallId: request.toolCallId,
			input,
			content: [...result.content],
			details: result.details,
			isError: false,
		});
		return transformed
			? {
					content: transformed.content ?? result.content,
					details: transformed.details ?? result.details,
				}
			: result;
	} catch (error) {
		if (runner.hasHandlers("tool_result")) {
			await runner.emitToolResult({
				type: "tool_result",
				toolName: tool.name,
				toolCallId: request.toolCallId,
				input,
				content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
				details: undefined,
				isError: true,
			});
		}
		throw error;
	}
}
