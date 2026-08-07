import { Type } from "@sinclair/typebox";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter/hooks";
import type { RuntimeToolDefinition, RuntimeToolExecutionRequest, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import {
	type EcosystemHookAwareRuntimeTool,
	type EcosystemHookAwareTool,
	wrapToolsWithEcosystemHooks,
} from "../../extensions/runtime/ecosystem-hook-tool-wrapper.js";

export type { EcosystemHookAwareRuntimeTool };

/** 在最终 Model Call Frame 上应用 Ecosystem Tool Hook 的完整执行语义。 */
export function wrapRuntimeToolsWithEcosystemHooks(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	hooks: EcosystemHookRuntime,
): ReadonlyMap<string, RuntimeToolDefinition> {
	return new Map([...tools].map(([name, tool]) => [name, wrapRuntimeTool(tool, hooks)]));
}

function wrapRuntimeTool(
	tool: EcosystemHookAwareRuntimeTool,
	hooks: EcosystemHookRuntime,
): EcosystemHookAwareRuntimeTool {
	return {
		...tool,
		execute: (request) => executeRuntimeToolWithHooks(tool, hooks, request),
	};
}

async function executeRuntimeToolWithHooks(
	runtimeTool: EcosystemHookAwareRuntimeTool,
	hooks: EcosystemHookRuntime,
	request: RuntimeToolExecutionRequest,
): Promise<RuntimeToolResult> {
	const agentTool: EcosystemHookAwareTool = {
		name: runtimeTool.name,
		label: runtimeTool.label,
		description: runtimeTool.description,
		parameters: Type.Unsafe<Record<string, unknown>>({ ...runtimeTool.inputSchema }),
		ecosystemHook: runtimeTool.ecosystemHook,
		execute: async (toolCallId, input, signal, onUpdate, context) =>
			toAgentToolResult(
				await runtimeTool.execute({
					sessionId: request.sessionId,
					turnId: request.turnId,
					toolCallId,
					input: input as Readonly<Record<string, unknown>>,
					messages: request.messages,
					signal: signal ?? new AbortController().signal,
					onUpdate: onUpdate ? (result) => onUpdate(toAgentToolResult(result)) : undefined,
					reportPhase: context?.phase,
				}),
			),
	};
	const wrapped = wrapToolsWithEcosystemHooks([agentTool], hooks)[0];
	if (!wrapped) return runtimeTool.execute(request);
	const context =
		request.reportPhase || request.messages
			? {
					phase: request.reportPhase ?? (() => {}),
					messages: request.messages,
				}
			: undefined;
	return wrapped.execute(request.toolCallId, request.input, request.signal, request.onUpdate, context);
}

function toAgentToolResult(result: RuntimeToolResult): {
	readonly content: [...RuntimeToolResult["content"]];
	readonly details: unknown;
} {
	return {
		content: [...result.content],
		details: result.details,
	};
}
