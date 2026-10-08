import type { AgentMessage } from "@astravia/agent-core";
import type { AssistantMessage, Usage } from "@astravia/ai";
import { ContextEstimateCalibration } from "./context-estimate-calibration.js";
import type { CompactionHistoryEntry, CompactionSettings } from "./contracts.js";

export function calculateContextTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function getAssistantUsage(message: AgentMessage): Usage | undefined {
	if (message.role !== "assistant" || !("usage" in message)) return undefined;
	const assistantMessage = message as AssistantMessage;
	if (assistantMessage.stopReason === "aborted" || assistantMessage.stopReason === "error") return undefined;
	return assistantMessage.usage;
}

export function getLastAssistantUsage(entries: readonly CompactionHistoryEntry[]): Usage | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "message") continue;
		const usage = getAssistantUsage(entry.message);
		if (usage) return usage;
	}
	return undefined;
}

export interface ContextUsageEstimate {
	readonly tokens: number;
	readonly usageTokens: number;
	readonly trailingTokens: number;
	readonly lastUsageIndex: number | null;
}

function getLastAssistantUsageInfo(
	messages: readonly AgentMessage[],
): { readonly usage: Usage; readonly index: number } | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const usage = getAssistantUsage(messages[index]);
		if (usage) return { usage, index };
	}
	return undefined;
}

export function estimateContextTokens(messages: readonly AgentMessage[]): ContextUsageEstimate {
	const usageInfo = getLastAssistantUsageInfo(messages);
	if (!usageInfo) {
		const tokens = messages.reduce((total, message) => total + estimateTokens(message), 0);
		return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
	}

	const usageTokens = calculateContextTokens(usageInfo.usage);
	let trailingTokens = 0;
	for (let index = usageInfo.index + 1; index < messages.length; index++) {
		trailingTokens += estimateTokens(messages[index]);
	}
	const overhead = estimateProviderOverhead(messages, usageInfo.index);
	return {
		tokens: usageTokens + trailingTokens + overhead,
		usageTokens,
		trailingTokens,
		lastUsageIndex: usageInfo.index,
	};
}

/**
 * 用会话内最近两个 assistant usage 锚点估算「逐字口径看不见的固定开销」
 * （系统提示词、工具 schema、缓存写放大计入 usage 而不计入逐字估算）。
 *
 * 锚点从消息列表自身推导：第 j 条 assistant 的 usage 对应携带 messages[0..j-1]
 * 的请求，残差 = usage − 逐字估算(messages[0..j-1])。比例带外的锚点拒收，
 * 连续向下突变冻结（见 context-estimate-calibration.ts）。只补低估、不缩小。
 */
function estimateProviderOverhead(messages: readonly AgentMessage[], lastUsageIndex: number): number {
	// 前缀累积估算：prefixEstimates[i] = estimate(messages[0..i-1])
	const prefixEstimates: number[] = [];
	let cumulative = 0;
	for (const message of messages) {
		prefixEstimates.push(cumulative);
		cumulative += estimateTokens(message);
	}

	// 取最近两个 usage 锚点（含 lastUsageIndex），按时间顺序喂给校准器
	const usageIndexes: number[] = [];
	for (let index = lastUsageIndex; index >= 0 && usageIndexes.length < 2; index -= 1) {
		const usage = getAssistantUsage(messages[index]);
		if (usage) usageIndexes.push(index);
	}
	usageIndexes.reverse();

	const calibration = new ContextEstimateCalibration();
	for (const index of usageIndexes) {
		calibration.record({
			estimateTokens: prefixEstimates[index] ?? 0,
			usageTokens: calculateContextTokens(getAssistantUsage(messages[index]) as Usage),
		});
	}
	const rawPrefix = prefixEstimates[lastUsageIndex] ?? 0;
	const correctedPrefix = calibration.correct(rawPrefix);
	return Math.max(0, correctedPrefix - rawPrefix);
}

export function getCompactThreshold(contextWindow: number, settings: CompactionSettings): number {
	const fixedThreshold = contextWindow - settings.reserveTokens;
	const percentThreshold = contextWindow * (1 - settings.minFreePercent / 100);
	return Math.max(fixedThreshold, percentThreshold);
}

export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	if (!settings.enabled) return false;
	return contextTokens > getCompactThreshold(contextWindow, settings);
}

/**
 * Conservatively estimate text tokens by script: ASCII follows chars/4, CJK and other
 * wide scripts (U+2E80 and up) count one token per code unit, and remaining non-ASCII
 * text counts half a token. Plain chars/4 undercounts Chinese by 3-4x, which lets a
 * single tool batch jump past the compaction threshold straight into a provider overflow.
 */
export function estimateTextTokens(text: string): number {
	let ascii = 0;
	let wide = 0;
	let other = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 0x80) ascii += 1;
		else if (code >= 0x2e80) wide += 1;
		else other += 1;
	}
	return ascii / 4 + wide + other / 2;
}

const IMAGE_TOKENS = 1200;

/** Conservatively estimate a message's tokens; see estimateTextTokens for the text policy. */
export function estimateTokens(message: AgentMessage): number {
	let tokens = 0;
	switch (message.role) {
		case "user": {
			const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
			if (typeof content === "string") {
				tokens = estimateTextTokens(content);
			} else {
				for (const block of content) {
					if (block.type === "text" && block.text) tokens += estimateTextTokens(block.text);
				}
			}
			return Math.ceil(tokens);
		}
		case "assistant":
			for (const block of message.content) {
				if (block.type === "text") tokens += estimateTextTokens(block.text);
				else if (block.type === "thinking") tokens += estimateTextTokens(block.thinking);
				else if (block.type === "toolCall")
					tokens += estimateTextTokens(block.name) + estimateTextTokens(JSON.stringify(block.arguments));
			}
			return Math.ceil(tokens);
		case "custom":
		case "toolResult":
			if (typeof message.content === "string") tokens = estimateTextTokens(message.content);
			else {
				for (const block of message.content) {
					if (block.type === "text" && block.text) tokens += estimateTextTokens(block.text);
					if (block.type === "image") tokens += IMAGE_TOKENS;
				}
			}
			return Math.ceil(tokens);
		case "bashExecution":
			return Math.ceil(estimateTextTokens(message.command) + estimateTextTokens(message.output));
		case "branchSummary":
		case "compactionSummary":
			return Math.ceil(estimateTextTokens(message.summary));
	}
	return 0;
}
