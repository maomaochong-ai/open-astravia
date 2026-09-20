import type { HistoryEntry } from "@vetta/runtime-core";

const PREVIEW_ENTRY_FALLBACK = 32;

/**
 * Keep the latest complete user turns for the renderer's first presentation.
 * The canonical history is loaded through the interactive Runtime afterwards.
 */
export function selectSessionHistoryPreview(history: readonly HistoryEntry[], tailTurns: number): HistoryEntry[] {
	let remainingTurns = tailTurns;
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const entry = history[index];
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		remainingTurns -= 1;
		if (remainingTurns === 0) return history.slice(index);
	}

	if (remainingTurns < tailTurns) return [...history];
	return history.slice(-PREVIEW_ENTRY_FALLBACK);
}
