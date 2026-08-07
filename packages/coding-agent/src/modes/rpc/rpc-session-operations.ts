import type { AgentMessage, ThinkingLevel } from "@vetta/agent-core";
import { type Api, type AssistantMessage, type Model, supportsXhigh } from "@vetta/ai";
import type { ConversationDocument } from "@vetta/runtime-core";
import type { CodingAgentHtmlExportRuntime } from "../../export-html/index.js";
import { projectCodingAgentMessages } from "../../sessions/projection/conversation-context-projector.js";
import type { SessionStats } from "./rpc-types.js";

export function computeCodingAgentRpcSessionStats(
	messages: readonly AgentMessage[],
	sessionFile: string | undefined,
	sessionId: string,
): SessionStats {
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

export function readCodingAgentRpcAgentMessages(document: ConversationDocument): readonly AgentMessage[] {
	return projectCodingAgentMessages(document);
}

export function resolveNextCodingAgentRpcThinkingLevel(
	model: Model<Api> | undefined,
	current: ThinkingLevel,
): ThinkingLevel | undefined {
	if (!model?.reasoning) return undefined;
	const levels: readonly ThinkingLevel[] = supportsXhigh(model)
		? ["off", "minimal", "low", "medium", "high", "xhigh"]
		: ["off", "minimal", "low", "medium", "high"];
	return levels[(levels.indexOf(current) + 1) % levels.length];
}

export function exportCodingAgentRpcConversation(
	htmlExporter: CodingAgentHtmlExportRuntime,
	document: ConversationDocument,
	sessionFile: string,
	outputPath?: string,
): Promise<string> {
	return htmlExporter.exportConversation(document, sessionFile, outputPath);
}
