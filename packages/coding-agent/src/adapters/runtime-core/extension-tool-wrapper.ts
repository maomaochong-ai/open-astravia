import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { ExtensionRunner } from "../../extensions/index.js";
import { DynamicContributionCatalog } from "../../interception/contribution-catalog.js";
import {
	CODING_AGENT_TOOL_INTERCEPTION_ORDER,
	type CodingAgentToolInterceptor,
} from "../../interception/tool/contracts.js";
import { wrapRuntimeToolsWithInterceptionPipeline } from "../../interception/tool/pipeline.js";

export type ExtensionToolEventRunner = Pick<ExtensionRunner, "hasHandlers" | "emitToolCall" | "emitToolResult">;

/** 兼容公开辅助函数；生产组合与测试均使用同一个显式 Tool Interception Pipeline。 */
export function wrapRuntimeToolsWithExtensions(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	runner: ExtensionToolEventRunner,
): ReadonlyMap<string, RuntimeToolDefinition> {
	const catalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
	catalog.register({
		sourceId: "coding-extension",
		localId: "tool-events",
		revision: "session",
		order: CODING_AGENT_TOOL_INTERCEPTION_ORDER.extension,
		value: createExtensionToolInterceptor(() => runner),
	});
	return wrapRuntimeToolsWithInterceptionPipeline(tools, catalog);
}

export function createExtensionToolInterceptor(
	readRunner: () => ExtensionToolEventRunner | undefined,
): CodingAgentToolInterceptor {
	return {
		before: async ({ tool, request, input }) => {
			const runner = readRunner();
			if (!runner) return undefined;
			if (!runner.hasHandlers("tool_call") && !runner.hasHandlers("tool_result")) return { state: runner };
			if (runner.hasHandlers("tool_call")) {
				let outcome: Awaited<ReturnType<ExtensionToolEventRunner["emitToolCall"]>>;
				try {
					outcome = await runner.emitToolCall({
						type: "tool_call",
						toolName: tool.name,
						toolCallId: request.toolCallId,
						input: { ...input },
					});
				} catch (error) {
					if (error instanceof Error) throw error;
					throw new Error(`Extension failed, blocking execution: ${String(error)}`);
				}
				if (outcome?.block) {
					return {
						block: { reason: outcome.reason || "Tool execution was blocked by an extension" },
						state: runner,
					};
				}
			}
			return { state: runner };
		},
		after: async ({ tool, request, input, result, state }) => {
			const runner = asRunner(state);
			if (!runner?.hasHandlers("tool_result")) return undefined;
			const transformed = await runner.emitToolResult({
				type: "tool_result",
				toolName: tool.name,
				toolCallId: request.toolCallId,
				input: { ...input },
				content: [...result.content],
				details: result.details,
				isError: false,
			});
			return transformed
				? {
						result: {
							content: transformed.content ?? result.content,
							details: transformed.details ?? result.details,
						},
					}
				: undefined;
		},
		onError: async ({ tool, request, input, error, state }) => {
			const runner = asRunner(state);
			if (!runner?.hasHandlers("tool_result")) return undefined;
			await runner.emitToolResult({
				type: "tool_result",
				toolName: tool.name,
				toolCallId: request.toolCallId,
				input: { ...input },
				content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
				details: undefined,
				isError: true,
			});
			return undefined;
		},
	};
}

function asRunner(state: unknown): ExtensionToolEventRunner | undefined {
	return state && typeof state === "object" ? (state as ExtensionToolEventRunner) : undefined;
}
