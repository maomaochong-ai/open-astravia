import type { HistoryEntry } from "@vetta/runtime-core";
import type { DesktopSessionSearchMatch } from "../../shared/session-search.js";
import { createSearchSnippet, normalizeSearchText } from "../../shared/session-search-text.js";

export { normalizeSearchText } from "../../shared/session-search-text.js";

export interface SessionSearchMessage {
	readonly role: "user" | "assistant";
	readonly entryId?: string;
	readonly normalizedText: string;
	readonly text: string;
}

function messageText(content: unknown, role: SessionSearchMessage["role"]): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			if (typeof part !== "object" || part === null) return [];
			const type = Reflect.get(part, "type");
			const text = Reflect.get(part, "text");
			// Untyped text blocks are a historical user-message format, not an assistant fallback.
			return (type === "text" || (role === "user" && type === undefined)) && typeof text === "string" ? [text] : [];
		})
		.join("\n");
}

export function extractSearchMessages(history: readonly HistoryEntry[]): SessionSearchMessage[] {
	return history.flatMap((entry) => {
		if (entry.type !== "message") return [];
		const { role, content } = entry.message;
		if (role !== "user" && role !== "assistant") return [];
		const text = messageText(content, role).replace(/\s+/g, " ").trim();
		return text ? [{ role, entryId: entry.entryId, normalizedText: normalizeSearchText(text), text }] : [];
	});
}

export function matchSearchMessage(
	messages: readonly SessionSearchMessage[],
	query: string,
): DesktopSessionSearchMatch | undefined {
	const message = messages.find(({ normalizedText }) => normalizedText.includes(query));
	if (!message) return undefined;
	return {
		field: message.role === "assistant" ? "assistantMessage" : "userMessage",
		entryId: message.entryId,
		snippet: createSearchSnippet(message.text, query),
	};
}
