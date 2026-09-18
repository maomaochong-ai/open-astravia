import type { AgentMessage } from "@vetta/agent-core";
import type { AssistantMessage, Usage } from "@vetta/ai";
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
	return {
		tokens: usageTokens + trailingTokens,
		usageTokens,
		trailingTokens,
		lastUsageIndex: usageInfo.index,
	};
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
