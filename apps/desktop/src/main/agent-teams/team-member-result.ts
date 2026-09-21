import type { AssistantMessage } from "@vetta/ai";
import type { HistoryEntry } from "@vetta/runtime-core";
import { type RuntimeFailure, readRuntimeFailure } from "@vetta/runtime-core/failures";

/** Read only this attempt's durable outcome, including turns whose host call returns void. */
export function findTeamAttemptFailure(
	history: readonly HistoryEntry[],
	previousEntryIds: ReadonlySet<string>,
): RuntimeFailure | undefined {
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const entry = history[index];
		if (!entry || !("entryId" in entry) || !entry.entryId || previousEntryIds.has(entry.entryId)) continue;
		if (entry.type === "error") {
			const failure = readRuntimeFailure(entry);
			if (failure) return failure;
		}
		if (entry.type === "message" && entry.message.role === "assistant" && isTeamAttemptFinalResult(entry.message))
			return undefined;
	}
	return undefined;
}

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

/** A publishable attempt result ends normally with visible text; anything else is only partial progress. */
export function isTeamAttemptFinalResult(message: AssistantMessage): boolean {
	if (message.stopReason === "error" || message.stopReason === "aborted") return false;
	return message.content.some((part) => part.type === "text" && part.text.trim().length > 0);
}
