import type { AgentMessage } from "@vetta/agent-core";
import type { AssistantMessage } from "@vetta/ai";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { CodingAgentSessionStats, CodingAgentToolInfo } from "../../public-api/sdk/sdk-session-contract.js";

export function toSdkToolInfo(tools: ReadonlyMap<string, RuntimeToolDefinition>): CodingAgentToolInfo[] {
	return [...tools.values()].map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.inputSchema,
	}));
}

export function readLastAssistantText(messages: readonly AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		const assistant = message as AssistantMessage;
		if (assistant.stopReason === "aborted" && assistant.content.length === 0) continue;
		const text = assistant.content
			.filter(
				(content): content is Extract<(typeof assistant.content)[number], { readonly type: "text" }> =>
					content.type === "text",
			)
			.map((content) => content.text)
			.join("")
			.trim();
		return text || undefined;
	}
	return undefined;
}

export function computeSdkSessionStats(
	messages: readonly AgentMessage[],
	sessionFile: string | undefined,
	sessionId: string,
): CodingAgentSessionStats {
	let toolCalls = 0;
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		const assistant = message as AssistantMessage;
		toolCalls += assistant.content.filter((content) => content.type === "toolCall").length;
		input += assistant.usage.input;
		output += assistant.usage.output;
		cacheRead += assistant.usage.cacheRead;
		cacheWrite += assistant.usage.cacheWrite;
		cost += assistant.usage.cost.total;
	}
	return {
		sessionFile,
		sessionId,
		userMessages: messages.filter((message) => message.role === "user").length,
		assistantMessages: messages.filter((message) => message.role === "assistant").length,
		toolCalls,
		toolResults: messages.filter((message) => message.role === "toolResult").length,
		totalMessages: messages.length,
		tokens: { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite },
		cost,
	};
}
