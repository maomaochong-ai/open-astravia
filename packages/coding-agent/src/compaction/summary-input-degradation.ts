import type { AgentMessage } from "@vetta/agent-core";
import type { AssistantMessage, ToolResultMessage } from "@vetta/ai";
import type { BashExecutionMessage } from "../model-context/index.js";
import { findRecentUserTurnBoundary } from "./user-turn-boundary.js";
import { sliceUtf8Start, utf8ByteLength } from "./utf8.js";

export type CompactionSummaryInputLevel = "full" | "compact-tool-results" | "essential" | "recent-three-turns";

export interface CompactionSummaryInputCandidate {
	readonly level: CompactionSummaryInputLevel;
	readonly messages: readonly AgentMessage[];
}

const COMPACT_TOOL_RESULT_BYTES = 2 * 1024;

export function createCompactionSummaryInputCandidates(
	messages: readonly AgentMessage[],
): readonly CompactionSummaryInputCandidate[] {
	const compact = messages.map(compactMessage);
	const essential = messages.map(toEssentialMessage);
	const recentBoundary = findRecentUserTurnBoundary(essential, 3);
	return [
		{ level: "full", messages: [...messages] },
		{ level: "compact-tool-results", messages: compact },
		{ level: "essential", messages: essential },
		{ level: "recent-three-turns", messages: essential.slice(recentBoundary) },
	];
}

function compactMessage(message: AgentMessage): AgentMessage {
	if (message.role === "toolResult") {
		const toolResult = message as ToolResultMessage;
		const text = toolResult.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n\n");
		if (utf8ByteLength(text) <= COMPACT_TOOL_RESULT_BYTES && !hasImage(toolResult)) return message;
		return {
			...toolResult,
			content: [{ type: "text", text: truncateUtf8(text, COMPACT_TOOL_RESULT_BYTES) }],
		};
	}
	if (message.role === "bashExecution") {
		const bash = message as BashExecutionMessage;
		if (utf8ByteLength(bash.output) <= COMPACT_TOOL_RESULT_BYTES) return message;
		return { ...bash, output: truncateUtf8(bash.output, COMPACT_TOOL_RESULT_BYTES) };
	}
	return message;
}

function toEssentialMessage(message: AgentMessage): AgentMessage {
	if (message.role === "toolResult") {
		const toolResult = message as ToolResultMessage;
		return {
			...toolResult,
			content: [
				{
					type: "text",
					text: `[Tool ${toolResult.toolName} ${toolResult.isError ? "failed" : "completed"}; detailed output omitted]`,
				},
			],
		};
	}
	if (message.role === "bashExecution") {
		const bash = message as BashExecutionMessage;
		return { ...bash, output: "[Bash output omitted]" };
	}
	if (message.role === "assistant") {
		const assistant = message as AssistantMessage;
		const content = assistant.content.filter((item) => item.type !== "thinking");
		return content.length === assistant.content.length ? message : { ...assistant, content };
	}
	return message;
}

function hasImage(message: ToolResultMessage): boolean {
	return message.content.some((item) => item.type === "image");
}

function truncateUtf8(value: string, maxBytes: number): string {
	return utf8ByteLength(value) <= maxBytes
		? value
		: `${sliceUtf8Start(value, maxBytes)}\n[truncated for compaction input]`;
}
