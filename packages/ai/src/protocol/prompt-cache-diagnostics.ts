import type { Context } from "./context.js";
import type { ImageContent, Message, TextContent, ThinkingContent } from "./message.js";
import type { Tool, ToolCall } from "./tool.js";
import type { PromptCacheChangedSegment, PromptCacheDiagnostics, PromptCachePrefixStatus } from "./usage.js";

const HASH_VERSION = "pc1";

/**
 * Computes privacy-safe, provider-neutral prefix fingerprints.
 *
 * Provider adapters may omit timestamps, usage, details, and other local
 * bookkeeping fields. The canonical projection mirrors that contract so the
 * diagnostic answers "did the provider-facing prefix change?", not merely
 * "did an internal message object change?".
 */
export function createPromptCacheDiagnostics(context: Context): PromptCacheDiagnostics {
	const systemPrompt = context.systemPrompt ?? "";
	const stableLength = normalizeStableLength(context.systemPromptStableLength, systemPrompt.length);
	const stableSystemPrompt = systemPrompt.slice(0, stableLength);
	const volatileSystemPrompt = systemPrompt.slice(stableLength);
	const requestMessages = context.messages.map(canonicalizeMessage);
	const history = requestMessages.slice(0, -1);
	const tools = (context.tools ?? []).map(canonicalizeTool);

	const stableSystemPromptHash = fingerprint(stableSystemPrompt);
	const volatileSystemPromptHash = fingerprint(volatileSystemPrompt);
	const toolsHash = fingerprint(tools);
	const historyPrefixHash = fingerprint(history);
	const requestMessagesHash = fingerprint(requestMessages);
	const cachePrefixHash = fingerprint({
		stableSystemPromptHash,
		toolsHash,
		historyPrefixHash,
	});
	const previous = findPreviousDiagnostics(context.messages);
	const comparison = compareWithPrevious({
		previous,
		stableSystemPromptHash,
		stableSystemPromptLength: stableSystemPrompt.length,
		volatileSystemPromptHash,
		volatileSystemPromptLength: volatileSystemPrompt.length,
		toolsHash,
		requestMessages,
	});

	return {
		cachePrefixHash,
		stableSystemPromptHash,
		volatileSystemPromptHash,
		toolsHash,
		historyPrefixHash,
		requestMessagesHash,
		requestMessageCount: requestMessages.length,
		prefixStatus: comparison.status,
		changedSegments: comparison.changedSegments,
		stableSystemPromptLength: stableSystemPrompt.length,
		volatileSystemPromptLength: volatileSystemPrompt.length,
		historyPrefixMessages: history.length,
		toolCount: tools.length,
	};
}

interface PreviousComparisonInput {
	readonly previous: PromptCacheDiagnostics | undefined;
	readonly stableSystemPromptHash: string;
	readonly stableSystemPromptLength: number;
	readonly volatileSystemPromptHash: string;
	readonly volatileSystemPromptLength: number;
	readonly toolsHash: string;
	readonly requestMessages: readonly unknown[];
}

function compareWithPrevious(input: PreviousComparisonInput): {
	status: PromptCachePrefixStatus;
	changedSegments: PromptCacheChangedSegment[];
} {
	if (!input.previous) return { status: "initial", changedSegments: [] };
	const previous = input.previous;
	if (previous.requestMessagesHash === undefined || previous.requestMessageCount === undefined) {
		return { status: "unknown", changedSegments: [] };
	}

	const changedSegments: PromptCacheChangedSegment[] = [];
	if (
		previous.stableSystemPromptHash !== input.stableSystemPromptHash ||
		previous.stableSystemPromptLength !== input.stableSystemPromptLength
	) {
		changedSegments.push("stable-system");
	}
	if (
		previous.volatileSystemPromptHash !== input.volatileSystemPromptHash ||
		previous.volatileSystemPromptLength !== input.volatileSystemPromptLength
	) {
		changedSegments.push("volatile-system");
	}
	if (previous.toolsHash !== input.toolsHash) changedSegments.push("tools");

	const previousMessagesRemainPrefix =
		previous.requestMessageCount <= input.requestMessages.length &&
		fingerprint(input.requestMessages.slice(0, previous.requestMessageCount)) === previous.requestMessagesHash;
	if (!previousMessagesRemainPrefix) changedSegments.push("messages");

	const stablePrefixChanged = changedSegments.some((segment) => segment !== "volatile-system");
	return { status: stablePrefixChanged ? "changed" : "extended", changedSegments };
}

function findPreviousDiagnostics(messages: readonly Message[]): PromptCacheDiagnostics | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "assistant" && message.usage.promptCache) return message.usage.promptCache;
	}
	return undefined;
}

function normalizeStableLength(value: number | undefined, promptLength: number): number {
	if (value === undefined) return promptLength;
	if (!Number.isFinite(value)) return 0;
	return Math.min(promptLength, Math.max(0, Math.trunc(value)));
}

function canonicalizeMessage(message: Message): unknown {
	switch (message.role) {
		case "user":
			return { role: message.role, content: canonicalizeContent(message.content) };
		case "assistant":
			return { role: message.role, content: canonicalizeContent(message.content) };
		case "toolResult":
			return {
				role: message.role,
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				content: canonicalizeContent(message.content),
				isError: message.isError,
			};
	}
}

function canonicalizeContent(
	content: string | readonly (TextContent | ThinkingContent | ImageContent | ToolCall)[],
): unknown {
	if (typeof content === "string") return content;
	return content.map((item) =>
		item.type === "image"
			? {
					type: item.type,
					mimeType: item.mimeType,
					dataLength: item.data.length,
					dataHash: fingerprint(item.data),
				}
			: item,
	);
}

function canonicalizeTool(tool: Tool): unknown {
	return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

function fingerprint(value: unknown): string {
	return `${HASH_VERSION}:${fnv1a(stableSerialize(value))}`;
}

function stableSerialize(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
	return `{${entries.join(",")}}`;
}

function fnv1a(value: string): string {
	return `${fnv1aWithSeed(value, 0x811c9dc5)}${fnv1aWithSeed(value, 0x9e3779b9)}`;
}

function fnv1aWithSeed(value: string, seed: number): string {
	let hash = seed;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
