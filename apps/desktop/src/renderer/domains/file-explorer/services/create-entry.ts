import { pathDirname } from "@shared/lib/utils";
import type { FsEntry } from "@shared/store/atoms";

export function resolveCreateParentDirectory(rootDir: string, selectedEntry: FsEntry | null): string {
	if (!selectedEntry) return rootDir;
	return selectedEntry.isDirectory ? selectedEntry.path : pathDirname(selectedEntry.path);
}
