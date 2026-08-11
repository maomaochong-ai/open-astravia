import type { EcosystemHookRuntime, EcosystemToolDescriptor } from "@vetta/ecosystem-adapter/hooks";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { EcosystemHookAwareRuntimeTool } from "../../extensions/runtime/ecosystem-hook-tool-wrapper.js";
import { DynamicContributionCatalog } from "../../interception/contribution-catalog.js";
import {
	CODING_AGENT_TOOL_INTERCEPTION_ORDER,
	type CodingAgentToolInterceptor,
} from "../../interception/tool/contracts.js";
import { wrapRuntimeToolsWithInterceptionPipeline } from "../../interception/tool/pipeline.js";

export type { EcosystemHookAwareRuntimeTool };

/** 兼容公开辅助函数；生产组合与测试均使用同一个显式 Tool Interception Pipeline。 */
export function wrapRuntimeToolsWithEcosystemHooks(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	hooks: EcosystemHookRuntime,
): ReadonlyMap<string, RuntimeToolDefinition> {
	const catalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
	catalog.register({
		sourceId: "ecosystem",
		localId: "tool-hooks",
		revision: "session",
		order: CODING_AGENT_TOOL_INTERCEPTION_ORDER.ecosystem,
		value: createEcosystemToolInterceptor(hooks),
	});
	return wrapRuntimeToolsWithInterceptionPipeline(tools, catalog);
}

export function createEcosystemToolInterceptor(hooks: EcosystemHookRuntime): CodingAgentToolInterceptor {
	return {
		before: async ({ tool, request, input }) => {
			const descriptor = toolDescriptor(tool);
			const outcome = await hooks.runPreToolUse(request.toolCallId, descriptor, input, request.signal);
			await hooks.recordAdditionalContexts(outcome.additionalContexts);
			if (outcome.shouldStop || outcome.shouldBlock) {
				return {
					block: {
						reason: outcome.stopReason ?? outcome.blockReason ?? "Tool execution blocked by ecosystem hook",
					},
				};
			}
			return { input: asToolInput(outcome.updatedToolInput) ?? input, state: Date.now() };
		},
		after: async ({ tool, request, input, result }) => {
			const outcome = await hooks.runPostToolUse(
				request.toolCallId,
				toolDescriptor(tool),
				input,
				result,
				request.signal,
			);
			await hooks.recordAdditionalContexts(outcome.additionalContexts);
			if (outcome.shouldStop || outcome.shouldBlock) {
				return {
					block: {
						reason:
							outcome.stopReason ??
							outcome.blockReason ??
							outcome.feedbackMessage ??
							"Tool result blocked by ecosystem hook",
					},
				};
			}
			return outcome.feedbackMessage === undefined
				? undefined
				: {
						result: {
							...result,
							content: [{ type: "text", text: outcome.feedbackMessage }],
						},
					};
		},
		onError: async ({ tool, request, input, error, state }) => {
			const message = error instanceof Error ? error.message : String(error);
			const startedAt = typeof state === "number" ? state : undefined;
			const outcome = await hooks.runPostToolUseFailure(request.toolCallId, toolDescriptor(tool), input, message, {
				isInterrupt: request.signal.aborted,
				durationMs: startedAt === undefined ? undefined : Date.now() - startedAt,
				signal: request.signal,
			});
			await hooks.recordAdditionalContexts(outcome.additionalContexts);
			return outcome.feedbackMessage ? { error: new Error(`${message}\n\n${outcome.feedbackMessage}`) } : undefined;
		},
	};
}

function asToolInput(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}

function toolDescriptor(tool: EcosystemHookAwareRuntimeTool): EcosystemToolDescriptor {
	const metadata = tool.ecosystemHook;
	if (metadata) return metadata;
	const hostName = tool.name;
	if (hostName === "bash" || hostName === "shell") return { hostName, kind: "shell" };
	if (hostName === "edit" || hostName === "write") return { hostName, kind: "file-edit" };
	if (hostName === "spawn_agent") return { hostName, kind: "agent" };
	if (hostName.startsWith("mcp_")) return { hostName, kind: "mcp" };
	return { hostName, kind: "function" };
}
