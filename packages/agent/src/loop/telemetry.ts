import type { AssistantMessage, Context, Tool } from "@vetta/ai";
import type { RuntimeObservationUpdate } from "@vetta/runtime-telemetry";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool, AgentToolResult } from "../types.js";

export function assistantTelemetryUpdate(message: AssistantMessage, captureContent: boolean): RuntimeObservationUpdate {
	const errorMessage =
		"errorMessage" in message && typeof message.errorMessage === "string" ? message.errorMessage : undefined;
	return {
		output: captureContent ? message.content : summarizeMessage(message),
		level: message.stopReason === "error" ? "ERROR" : "DEFAULT",
		statusMessage: errorMessage,
		usageDetails: {
			input: message.usage.input,
			output: message.usage.output,
			cacheRead: message.usage.cacheRead,
			cacheWrite: message.usage.cacheWrite,
			totalTokens: message.usage.totalTokens,
		},
		costDetails: {
			input: message.usage.cost.input,
			output: message.usage.cost.output,
			cacheRead: message.usage.cost.cacheRead,
			cacheWrite: message.usage.cost.cacheWrite,
			total: message.usage.cost.total,
		},
		metadata: {
			api: message.api,
			provider: message.provider,
			model: message.model,
			stopReason: message.stopReason,
			content: summarizeMessage(message),
		},
	};
}

export function traceAttributes(
	tracing: AgentLoopConfig["tracing"],
): Pick<RuntimeObservationUpdate, "userId" | "sessionId" | "traceName" | "tags" | "version"> {
	return {
		userId: tracing?.userId,
		sessionId: tracing?.sessionId,
		traceName: tracing?.traceName,
		tags: tracing?.tags,
		version: tracing?.version,
	};
}

export function agentRunInput(
	context: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	captureContent: boolean,
): Record<string, unknown> {
	return {
		triggerMessages: captureContent ? newMessages : summarizeMessages(newMessages),
		messages: captureContent ? context.messages : undefined,
		existingMessageCount: Math.max(context.messages.length - newMessages.length, 0),
		systemPrompt: captureContent ? context.systemPrompt : summarizeText(context.systemPrompt),
		tools: captureContent ? context.tools?.map(serializeTool) : summarizeTools(context.tools),
		model: {
			id: config.model.id,
			provider: config.model.provider,
			api: config.model.api,
		},
	};
}

export function agentRunOutput(messages: AgentMessage[], captureContent: boolean): Record<string, unknown> {
	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
	return {
		messageCount: messages.length,
		assistantMessageCount: messages.filter((message) => message.role === "assistant").length,
		toolResultCount: messages.filter((message) => message.role === "toolResult").length,
		toolCallCount: countToolCalls(messages),
		usageDetails: aggregateUsage(messages),
		costDetails: aggregateCost(messages),
		messages: captureContent ? messages : summarizeMessages(messages),
		finalAssistant: lastAssistant ? (captureContent ? lastAssistant : summarizeMessage(lastAssistant)) : undefined,
	};
}

export function generationInput(
	context: Context,
	agentMessages: AgentMessage[],
	captureContent: boolean,
): Record<string, unknown> {
	return {
		systemPrompt: captureContent ? context.systemPrompt : summarizeText(context.systemPrompt),
		messages: captureContent ? context.messages : summarizeMessages(agentMessages),
		tools: captureContent ? context.tools?.map(serializeTool) : summarizeTools(context.tools),
	};
}

export function toolCallInput(
	tool: AgentTool | undefined,
	toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
	captureContent: boolean,
): Record<string, unknown> {
	return {
		call: {
			id: toolCall.id,
			name: toolCall.name,
			arguments: captureContent ? toolCall.arguments : { keys: objectKeys(toolCall.arguments) },
		},
		tool: tool ? (captureContent ? serializeTool(tool) : summarizeTool(tool)) : undefined,
	};
}

export function telemetryModelParameters(config: AgentLoopConfig): Record<string, string | number> {
	const parameters: Record<string, string | number> = {};
	if (config.reasoning) parameters.reasoning = config.reasoning;
	if (config.transport) parameters.transport = config.transport;
	return parameters;
}

export function aggregateUsage(messages: AgentMessage[]): Record<string, number> {
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		usage.input += message.usage.input;
		usage.output += message.usage.output;
		usage.cacheRead += message.usage.cacheRead;
		usage.cacheWrite += message.usage.cacheWrite;
		usage.totalTokens += message.usage.totalTokens;
	}
	return usage;
}

export function aggregateCost(messages: AgentMessage[]): Record<string, number> {
	const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		cost.input += message.usage.cost.input;
		cost.output += message.usage.cost.output;
		cost.cacheRead += message.usage.cost.cacheRead;
		cost.cacheWrite += message.usage.cost.cacheWrite;
		cost.total += message.usage.cost.total;
	}
	return cost;
}

export function countToolCalls(messages: AgentMessage[]): number {
	let count = 0;
	for (const message of messages) {
		if (message.role === "assistant") {
			count += message.content.filter((block) => block.type === "toolCall").length;
		}
	}
	return count;
}

export function objectKeys(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.keys(value);
}

export function textFromToolResult(result: AgentToolResult<unknown>): string | undefined {
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return text || undefined;
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function serializeTool(tool: Tool): Record<string, unknown> {
	return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

function summarizeTools(tools: Tool[] | undefined): Array<Record<string, unknown>> {
	return tools?.map(summarizeTool) ?? [];
}

function summarizeTool(tool: Tool): Record<string, unknown> {
	return {
		name: tool.name,
		description: summarizeText(tool.description),
		parameterKeys: objectKeys(tool.parameters?.properties),
		required: Array.isArray(tool.parameters?.required) ? tool.parameters.required : [],
	};
}

function summarizeText(value: string | undefined): Record<string, unknown> {
	return { present: typeof value === "string" && value.length > 0, length: value?.length ?? 0 };
}

function summarizeMessages(messages: AgentMessage[]): Array<Record<string, unknown>> {
	return messages.map(summarizeMessage);
}

function summarizeMessage(message: AgentMessage): Record<string, unknown> {
	const summary: Record<string, unknown> = {};
	if ("role" in message) summary.role = message.role;
	if ("content" in message && Array.isArray(message.content)) {
		summary.contentBlocks = message.content.map((block) =>
			typeof block === "object" && block !== null && "type" in block ? block.type : typeof block,
		);
		summary.toolCalls = message.content
			.filter((block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => {
				return typeof block === "object" && block !== null && "type" in block && block.type === "toolCall";
			})
			.map((block) => ({ id: block.id, name: block.name }));
	}
	if ("stopReason" in message) summary.stopReason = message.stopReason;
	if ("isError" in message) summary.isError = message.isError;
	return summary;
}
