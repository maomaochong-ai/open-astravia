import { atom } from "jotai";

export interface FsEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	modifiedAt: number;
}

export interface FileEditorDocumentState {
	path: string;
	savedContent: string;
	draftContent: string;
	revision: string;
	hasBom: boolean;
	lineEnding: "lf" | "crlf";
	size: number;
	modifiedAt: number;
	conflictRevision?: string;
	/**
	 * CodeMirror remount identity. Stable across save/draft edits; only bumps when
	 * the buffer is replaced from disk (open/reload/external clean replace).
	 */
	editorGeneration: number;
}

export const fileTreeCacheAtom = atom<Map<string, FsEntry[]>>(new Map());
export const expandedDirsAtom = atom<Set<string>>(new Set<string>());
export const loadingDirsAtom = atom<Set<string>>(new Set<string>());
export const fileContextMenuAtom = atom<{ x: number; y: number; entry: FsEntry; isRoot?: boolean } | null>(null);
export const renamingPathAtom = atom<string | null>(null);
export const fileEditorDocumentsAtom = atom<Map<string, FileEditorDocumentState>>(new Map());
export const fileEditorHasUnsavedChangesAtom = atom((get) => {
	for (const document of get(fileEditorDocumentsAtom).values()) {
		if (document.draftContent !== document.savedContent) return true;
	}
	return false;
});
