import { pathDirname } from "@shared/lib/utils";
import type { FsEntry } from "@shared/store/atoms";

/** App-internal file clipboard — copy only (no cut). */
export type FileExplorerClipboard = {
	entries: readonly FsEntry[];
};

/**
 * Paste destination:
 * - blank / no selection → workspace root
 * - focused/selected directory → inside that directory
 * - focused/selected file → its parent
 */
export function resolvePasteDirectory(
	rootDir: string,
	focusedEntry: FsEntry | null,
	selectedEntries: readonly FsEntry[],
): string {
	const primary = focusedEntry ?? selectedEntries[selectedEntries.length - 1] ?? null;
	if (!primary) return rootDir;
	return primary.isDirectory ? primary.path : pathDirname(primary.path);
}
