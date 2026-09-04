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
