import { atom } from "jotai";
import {
	FILE_EXPLORER_PREFERENCES_KEY,
	type FileExplorerPreferences,
	normalizeFileExplorerPreferences,
	readFileExplorerPreferences,
} from "../lib/file-explorer-preferences";

const fileExplorerPreferencesStateAtom = atom(readFileExplorerPreferences());
export const fileExplorerPreferencesAtom = atom(
	(get) => get(fileExplorerPreferencesStateAtom),
	(_get, set, value: FileExplorerPreferences) => {
		const preferences = normalizeFileExplorerPreferences(value);
		localStorage.setItem(FILE_EXPLORER_PREFERENCES_KEY, JSON.stringify(preferences));
		set(fileExplorerPreferencesStateAtom, preferences);
	},
);

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

/**
 * 待处理请求：让文件树展开祖先目录、选中并滚动到某个文件。
 *
 * 聊天里的文件链接和文件树属于两个域，而且点开时文件 tab 往往还没挂载——
 * 此刻树那边没有可用的 reveal 句柄。这里用一条一次性请求跨过这次挂载边界：
 * 树挂载后自己消费并清空，路径不在自己的工作区根下就不动它。
 *
 * 请求带自增 `id` 而非只比较路径：同一条路径再点一次也是新请求，消费方按 id
 * 去重与清空，不会因为上一笔请求没清干净而永久失效。
 */
export interface FileExplorerRevealRequest {
	path: string;
	id: number;
}

const fileExplorerRevealRequestStateAtom = atom<FileExplorerRevealRequest | null>(null);
const fileExplorerRevealSequenceAtom = atom(0);

export const fileExplorerRevealRequestAtom = atom((get) => get(fileExplorerRevealRequestStateAtom));

/** 发起一次 reveal 请求；同一路径重复发起也会得到新的 id。 */
export const requestFileExplorerRevealAtom = atom(null, (get, set, path: string) => {
	const id = get(fileExplorerRevealSequenceAtom) + 1;
	set(fileExplorerRevealSequenceAtom, id);
	set(fileExplorerRevealRequestStateAtom, { path, id });
});

/** 按 id 清空：期间若已经换成新请求，保留新的那条。 */
export const clearFileExplorerRevealRequestAtom = atom(null, (get, set, id: number) => {
	if (get(fileExplorerRevealRequestStateAtom)?.id === id) set(fileExplorerRevealRequestStateAtom, null);
});

export const fileEditorDocumentsAtom = atom<Map<string, FileEditorDocumentState>>(new Map());
export const fileEditorHasUnsavedChangesAtom = atom((get) => {
	for (const document of get(fileEditorDocumentsAtom).values()) {
		if (document.draftContent !== document.savedContent) return true;
	}
	return false;
});
