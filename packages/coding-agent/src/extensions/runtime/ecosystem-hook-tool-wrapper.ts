import type { TSchema } from "@sinclair/typebox";
import type { AgentTool } from "@vetta/agent-core";
import type { EcosystemHookRuntime, EcosystemToolDescriptor } from "@vetta/ecosystem-adapter/hooks";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";

export type EcosystemHookAwareTool = AgentTool & { ecosystemHook?: EcosystemToolDescriptor };
export type EcosystemHookAwareRuntimeTool = RuntimeToolDefinition & {
	readonly ecosystemHook?: EcosystemToolDescriptor;
};

const HOOK_BLOCKED = Symbol("ecosystemHookBlocked");

export function wrapToolsWithEcosystemHooks<TParameters extends TSchema, TDetails>(
	tools: AgentTool<TParameters, TDetails>[],
	hooks: EcosystemHookRuntime,
): AgentTool<TParameters, TDetails>[] {
	return tools.map((tool) => wrapTool(tool, hooks));
}

function wrapTool<TParameters extends TSchema, TDetails>(
	tool: AgentTool<TParameters, TDetails>,
	hooks: EcosystemHookRuntime,
): AgentTool<TParameters, TDetails> {
	return {
		...tool,
		execute: async (toolCallId, params, signal, onUpdate, context) => {
			const descriptor = toolDescriptor(tool);
			const pre = await hooks.runPreToolUse(toolCallId, descriptor, params, signal);
			await hooks.recordAdditionalContexts(pre.additionalContexts);
			if (pre.shouldStop || pre.shouldBlock) {
				const reason = pre.stopReason ?? pre.blockReason ?? "Tool execution blocked by ecosystem hook";
				console.info("[ecosystem-hooks] pre-tool blocked", {
					tool: descriptor.hostName,
					toolUseId: toolCallId,
					shouldStop: pre.shouldStop,
					shouldBlock: pre.shouldBlock,
					reason,
				});
				throw markHookBlocked(new Error(reason));
			}
			const executionParams = (pre.updatedToolInput ?? params) as typeof params;
			const startedAt = Date.now();

			try {
				const result = await tool.execute(toolCallId, executionParams, signal, onUpdate, context);
				const post = await hooks.runPostToolUse(toolCallId, descriptor, executionParams, result, signal);
				await hooks.recordAdditionalContexts(post.additionalContexts);
				if (post.shouldStop || post.shouldBlock) {
					const reason =
						post.stopReason ??
						post.blockReason ??
						post.feedbackMessage ??
						"Tool result blocked by ecosystem hook";
					console.info("[ecosystem-hooks] post-tool blocked", {
						tool: descriptor.hostName,
						toolUseId: toolCallId,
						shouldStop: post.shouldStop,
						shouldBlock: post.shouldBlock,
						reason,
					});
					throw markHookBlocked(new Error(reason));
				}
				return post.feedbackMessage === undefined
					? result
					: {
							...result,
							content: [{ type: "text", text: post.feedbackMessage }],
						};
			} catch (error) {
				if (isHookBlocked(error)) throw error;

				const message = error instanceof Error ? error.message : String(error);
				const failure = await hooks.runPostToolUseFailure(toolCallId, descriptor, executionParams, message, {
					isInterrupt: signal?.aborted === true,
					durationMs: Date.now() - startedAt,
					signal,
				});
				await hooks.recordAdditionalContexts(failure.additionalContexts);
				if (failure.feedbackMessage) {
					throw new Error(`${message}\n\n${failure.feedbackMessage}`);
				}
				throw error;
			}
		},
	};
}

function markHookBlocked(error: Error): Error {
	(error as Error & { [HOOK_BLOCKED]?: true })[HOOK_BLOCKED] = true;
	return error;
}

function isHookBlocked(error: unknown): boolean {
	return typeof error === "object" && error !== null && HOOK_BLOCKED in error;
}

function toolDescriptor(tool: { name: string; ecosystemHook?: EcosystemToolDescriptor }): EcosystemToolDescriptor {
	const metadata = tool.ecosystemHook;
	if (metadata) return metadata;
	const hostName = tool.name;
	if (hostName === "bash" || hostName === "shell") return { hostName, kind: "shell" };
	if (hostName === "edit" || hostName === "write") return { hostName, kind: "file-edit" };
	if (hostName === "spawn_agent") return { hostName, kind: "agent" };
	if (hostName.startsWith("mcp_")) return { hostName, kind: "mcp" };
	return { hostName, kind: "function" };
}
