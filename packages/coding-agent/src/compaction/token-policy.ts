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

/** Conservatively estimate a message with the established chars/4 policy. */
export function estimateTokens(message: AgentMessage): number {
	let chars = 0;
	switch (message.role) {
		case "user": {
			const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
			if (typeof content === "string") {
				chars = content.length;
			} else {
				for (const block of content) {
					if (block.type === "text" && block.text) chars += block.text.length;
				}
			}
			return Math.ceil(chars / 4);
		}
		case "assistant":
			for (const block of message.content) {
				if (block.type === "text") chars += block.text.length;
				else if (block.type === "thinking") chars += block.thinking.length;
				else if (block.type === "toolCall") chars += block.name.length + JSON.stringify(block.arguments).length;
			}
			return Math.ceil(chars / 4);
		case "custom":
		case "toolResult":
			if (typeof message.content === "string") chars = message.content.length;
			else {
				for (const block of message.content) {
					if (block.type === "text" && block.text) chars += block.text.length;
					if (block.type === "image") chars += 4800;
				}
			}
			return Math.ceil(chars / 4);
		case "bashExecution":
			return Math.ceil((message.command.length + message.output.length) / 4);
		case "branchSummary":
		case "compactionSummary":
			return Math.ceil(message.summary.length / 4);
	}
	return 0;
}
