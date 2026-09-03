import type { AssistantMessage } from "@vetta/ai";
import type { HistoryEntry } from "@vetta/runtime-core";

/** Model-visible message counts shrink on compaction; durable entry ids do not. */
export function findTeamAttemptResult(
	history: readonly HistoryEntry[],
	previousEntryIds: ReadonlySet<string>,
): { readonly entryId: string; readonly message: AssistantMessage } | undefined {
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const entry = history[index];
		if (
			entry?.type === "message" &&
			entry.entryId &&
			!previousEntryIds.has(entry.entryId) &&
			entry.message.role === "assistant"
		) {
			return { entryId: entry.entryId, message: entry.message };
		}
	}
	return undefined;
}

/** Restores display-only tool calls from a member transcript without changing the public Conversation. */
export function restoreTeamPublicToolCalls(
	message: AssistantMessage,
	history: readonly HistoryEntry[],
	sourceMessageEntryId: string,
): AssistantMessage {
	if (message.content.some((part) => part.type === "toolCall")) return message;
	const sourceIndex = history.findIndex((entry) => entry.type === "message" && entry.entryId === sourceMessageEntryId);
	if (sourceIndex < 0) return message;
	let startIndex = sourceIndex;
	while (startIndex > 0) {
		const previous = history[startIndex - 1];
		if (previous?.type === "message" && previous.message.role === "user") break;
		startIndex -= 1;
	}
	const toolCalls = history.slice(startIndex, sourceIndex + 1).flatMap((entry) => {
		if (entry.type !== "message" || entry.message.role !== "assistant") return [];
		return entry.message.content.filter((part) => part.type === "toolCall");
	});
	return toolCalls.length > 0 ? { ...message, content: [...toolCalls, ...message.content] } : message;
}
