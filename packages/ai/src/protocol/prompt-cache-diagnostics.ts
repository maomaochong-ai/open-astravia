import type { Context } from "./context.js";
import type { ImageContent, Message, TextContent, ThinkingContent } from "./message.js";
import type { Tool, ToolCall } from "./tool.js";
import type { PromptCacheDiagnostics } from "./usage.js";

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
	const history = context.messages.slice(0, -1).map(canonicalizeMessage);
	const tools = (context.tools ?? []).map(canonicalizeTool);

	const stableSystemPromptHash = fingerprint(stableSystemPrompt);
	const volatileSystemPromptHash = fingerprint(volatileSystemPrompt);
	const toolsHash = fingerprint(tools);
	const historyPrefixHash = fingerprint(history);
	const cachePrefixHash = fingerprint({
		stableSystemPromptHash,
		toolsHash,
		historyPrefixHash,
	});

	return {
		cachePrefixHash,
		stableSystemPromptHash,
		volatileSystemPromptHash,
		toolsHash,
		historyPrefixHash,
		stableSystemPromptLength: stableSystemPrompt.length,
		volatileSystemPromptLength: volatileSystemPrompt.length,
		historyPrefixMessages: history.length,
		toolCount: tools.length,
	};
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
