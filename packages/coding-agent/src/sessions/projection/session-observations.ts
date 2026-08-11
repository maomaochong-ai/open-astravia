import type { AgentMessage } from "@vetta/agent-core";
import type { AssistantMessage } from "@vetta/ai";

export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
}

export function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map((item) => item.text)
		.join("");
}

export function computeSessionStats(dependencies: {
	messages: AgentMessage[];
	sessionFile: string | undefined;
	sessionId: string;
}): SessionStats {
	const userMessages = dependencies.messages.filter((message) => message.role === "user").length;
	const assistantMessages = dependencies.messages.filter((message) => message.role === "assistant").length;
	const toolResults = dependencies.messages.filter((message) => message.role === "toolResult").length;
	let toolCalls = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;

	for (const message of dependencies.messages) {
		if (message.role !== "assistant") continue;
		const assistantMessage = message as AssistantMessage;
		toolCalls += assistantMessage.content.filter((content) => content.type === "toolCall").length;
		totalInput += assistantMessage.usage.input;
		totalOutput += assistantMessage.usage.output;
		totalCacheRead += assistantMessage.usage.cacheRead;
		totalCacheWrite += assistantMessage.usage.cacheWrite;
		totalCost += assistantMessage.usage.cost.total;
	}

	return {
		sessionFile: dependencies.sessionFile,
		sessionId: dependencies.sessionId,
		userMessages,
		assistantMessages,
		toolCalls,
		toolResults,
		totalMessages: dependencies.messages.length,
		tokens: {
			input: totalInput,
			output: totalOutput,
			cacheRead: totalCacheRead,
			cacheWrite: totalCacheWrite,
			total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
		},
		cost: totalCost,
	};
}

export function getLastAssistantText(messages: AgentMessage[]): string | undefined {
	const lastAssistant = messages
		.slice()
		.reverse()
		.find((message) => {
			if (message.role !== "assistant") return false;
			const assistantMessage = message as AssistantMessage;
			return assistantMessage.stopReason !== "aborted" || assistantMessage.content.length > 0;
		});
	if (!lastAssistant) return undefined;

	const text = (lastAssistant as AssistantMessage).content
		.filter(
			(content): content is Extract<AssistantMessage["content"][number], { type: "text" }> =>
				content.type === "text",
		)
		.map((content) => content.text)
		.join("");
	return text.trim() || undefined;
}
