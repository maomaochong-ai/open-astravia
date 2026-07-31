export interface FsEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	modifiedAt: number;
}

/** 递归列文件返回的轻量条目（不含 stat，relPath 相对 root，用于模糊匹配/展示）。 */
export interface FsFileRef {
	name: string;
	path: string;
	relPath: string;
}

export interface FsStatResult {
	size: number;
	modifiedAt: number;
	createdAt: number;
}

export const FS_EDITABLE_TEXT_ERROR = {
	TOO_LARGE: "FS_EDITABLE_TEXT_TOO_LARGE",
	NOT_UTF8: "FS_EDITABLE_TEXT_NOT_UTF8",
	NOT_FILE: "FS_EDITABLE_TEXT_NOT_FILE",
} as const;

export interface FsEditableTextSnapshot {
	content: string;
	revision: string;
	hasBom: boolean;
	lineEnding: "lf" | "crlf";
	size: number;
	modifiedAt: number;
}

export interface FsSaveEditableTextOptions {
	expectedRevision: string;
	force?: boolean;
	hasBom?: boolean;
}

export type FsSaveEditableTextResult =
	| {
			status: "saved";
			revision: string;
			size: number;
			modifiedAt: number;
	  }
	| {
			status: "conflict";
			revision: string;
	  };

export type FileTransferAction = "copy" | "move";
export type FileTransferConflictPolicy = "keep-both" | "replace" | "skip";
export type FileExplorerEntryKind = "file" | "directory";

export interface FileTransferPlanItem {
	name: string;
	isDirectory: boolean;
	hasConflict: boolean;
}

export interface FileTransferPlan {
	id: string;
	destinationDirectory: string;
	items: FileTransferPlanItem[];
}

export interface FileTransferItemResult {
	name: string;
	status: "copied" | "moved" | "skipped" | "failed";
	destinationPath?: string;
	error?: string;
}

export interface FileTransferResult {
	items: FileTransferItemResult[];
}

export interface DesktopFsApi {
	readDir(dirPath: string): Promise<FsEntry[]>;
	readFile(filePath: string): Promise<{ content: string; encoding: "utf8" | "base64" }>;
	readEditableTextFile(filePath: string): Promise<FsEditableTextSnapshot>;
	saveEditableTextFile(
		filePath: string,
		content: string,
		options: FsSaveEditableTextOptions,
	): Promise<FsSaveEditableTextResult>;
	/** `encoding: "base64"` writes decoded bytes (for binary assets). Default utf8. */
	writeFile(filePath: string, content: string, encoding?: "utf8" | "base64"): Promise<void>;
	stat(filePath: string): Promise<FsStatResult | null>;
	rename(oldPath: string, newPath: string): Promise<void>;
	delete(targetPath: string): Promise<void>;
	move(sourcePath: string, destDir: string): Promise<void>;
	prepareDrop(files: readonly File[], destinationDirectory: string): Promise<FileTransferPlan>;
	commitDrop(
		planId: string,
		action: FileTransferAction,
		conflictPolicy: FileTransferConflictPolicy,
	): Promise<FileTransferResult>;
	cancelDrop(planId: string): Promise<void>;
	/** Starts an operating-system drag synchronously from a renderer dragstart event. */
	startDrag(paths: readonly string[]): void;
	createEntry(parentDirectory: string, name: string, kind: FileExplorerEntryKind): Promise<FsEntry>;
	createDirectory(dirPath: string): Promise<void>;
	listSubDirs(dirPath: string): Promise<FsEntry[]>;
	/** 递归列出 rootPath 下所有文件（跳过隐藏/重型目录，有数量上限），用于 @ 引用的全局模糊匹配。 */
	listFilesRecursive(rootPath: string): Promise<FsFileRef[]>;
	watchDir(dirPath: string): Promise<void>;
	unwatchDir(dirPath: string): Promise<void>;
	onDirChanged(handler: (dirPath: string) => void): () => void;
	/**
	 * 同步获取 drag-and-drop / `<input type=file>` File 对象的绝对路径。
	 * Electron 32+ 已移除 `File.path`，统一通过 preload 的 webUtils 转换。
	 * 返回空字符串表示该 File 不来自真实文件系统（例如来自剪贴板的合成 File）。
	 */
	pathForFile(file: File): string;
}
