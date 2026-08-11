import type { TSchema } from "@sinclair/typebox";
import type { AgentTool } from "@vetta/agent-core";
import type { ExtensionContext } from "../context-contracts.js";
import type { ToolCallEvent, ToolCallEventResult, ToolResultEvent, ToolResultEventResult } from "../events/index.js";
import type { RegisteredTool } from "../runtime-contracts.js";

export interface ExtensionToolPipelineHost {
	hasHandlers(eventType: string): boolean;
	createContext(): ExtensionContext;
	emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined>;
	emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined>;
}

export function wrapRegisteredTool(
	registeredTool: RegisteredTool,
	runner: ExtensionToolPipelineHost,
): AgentTool<TSchema, unknown> {
	const { definition } = registeredTool;
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		scope_use: definition.scope_use,
		requires: definition.requires,
		category: definition.category,
		execute: (toolCallId, params, signal, onUpdate) =>
			definition.execute(toolCallId, params, signal, onUpdate, runner.createContext()),
	};
}

export function wrapRegisteredTools(
	registeredTools: RegisteredTool[],
	runner: ExtensionToolPipelineHost,
): Array<AgentTool<TSchema, unknown>> {
	return registeredTools.map((tool) => wrapRegisteredTool(tool, runner));
}

export function wrapToolWithExtensions<TParameters extends TSchema, TDetails>(
	tool: AgentTool<TParameters, TDetails>,
	runner: ExtensionToolPipelineHost,
): AgentTool<TParameters, TDetails> {
	return {
		...tool,
		execute: async (toolCallId, params, signal, onUpdate) => {
			const input = params as Record<string, unknown>;
			if (runner.hasHandlers("tool_call")) {
				try {
					const callResult = await runner.emitToolCall({
						type: "tool_call",
						toolName: tool.name,
						toolCallId,
						input,
					});
					if (callResult?.block) {
						throw new Error(callResult.reason || "Tool execution was blocked by an extension");
					}
				} catch (error) {
					if (error instanceof Error) throw error;
					throw new Error(`Extension failed, blocking execution: ${String(error)}`);
				}
			}

			try {
				const result = await tool.execute(toolCallId, params, signal, onUpdate);
				if (!runner.hasHandlers("tool_result")) return result;
				const transformed = await runner.emitToolResult({
					type: "tool_result",
					toolName: tool.name,
					toolCallId,
					input,
					content: result.content,
					details: result.details,
					isError: false,
				});
				return transformed
					? {
							content: transformed.content ?? result.content,
							details: (transformed.details ?? result.details) as TDetails,
						}
					: result;
			} catch (error) {
				if (runner.hasHandlers("tool_result")) {
					await runner.emitToolResult({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input,
						content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
						details: undefined,
						isError: true,
					});
				}
				throw error;
			}
		},
	};
}

export function wrapToolsWithExtensions<TParameters extends TSchema, TDetails>(
	tools: Array<AgentTool<TParameters, TDetails>>,
	runner: ExtensionToolPipelineHost,
): Array<AgentTool<TParameters, TDetails>> {
	return tools.map((tool) => wrapToolWithExtensions(tool, runner));
}
