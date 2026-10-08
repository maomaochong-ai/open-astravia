import type { AgentMessage } from "@astravia/agent-core";
import type { AssistantMessage, ToolResultMessage } from "@astravia/ai";
import type { BashExecutionMessage } from "../model-context/index.js";
import { estimateTokens } from "./token-policy.js";
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

/**
 * 预检的安全边际：摘要系统提示词 + 指令 + 文件账目的粗略量级。
 * 这部分计入真实输入窗口，但不入逐字候选估算，预检时从预算中扣除。
 */
const PREFILTER_OVERHEAD_TOKENS = 4_000;

/** 逐字口径估算一个候选的输入 token（与压缩触发同口径）。 */
export function estimateCandidateTokens(candidate: CompactionSummaryInputCandidate): number {
	return candidate.messages.reduce((total, message) => total + estimateTokens(message), 0);
}

/**
 * 降级链预检：把「发出去必然超限」的候选提前拦下，避免瀑布式空跑。
 *
 * 旧流程对 full 档超限的响应是让 provider 报 input-too-large 再逐档重试——每次
 * 空跑都是一次完整的失败请求（含排队与超时）。长会话（恰是最需要压缩的场景）
 * full 档几乎必超：预检用与触发判定同源的逐字口径先估一遍，超预算的档直接跳过。
 *
 * 全部超限时保留最小档（recent-three-turns）——宁降级也不返回空链。
 * contextWindow 未知（0/undefined）时不预检，维持旧行为。
 */
export function prefilterSummaryCandidates(
	candidates: readonly CompactionSummaryInputCandidate[],
	contextWindow: number,
	outputBudget: number,
): readonly CompactionSummaryInputCandidate[] {
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return candidates;
	const inputBudget = contextWindow - outputBudget - PREFILTER_OVERHEAD_TOKENS;
	if (inputBudget <= 0) return candidates;
	const kept = candidates.filter((candidate) => estimateCandidateTokens(candidate) <= inputBudget);
	if (kept.length > 0) return kept;
	return [candidates[candidates.length - 1] as CompactionSummaryInputCandidate];
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
