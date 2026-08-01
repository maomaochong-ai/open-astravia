import type { ReactNode } from "react";

/** Plain filesystem entry for tree UI (no desktop store dependency). */
export interface FileExplorerEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	modifiedAt: number;
}

/** Minimal entry shape for native drag (paths + type for app file icons). */
export interface FileExplorerDragEntry {
	name: string;
	path: string;
	isDirectory: boolean;
}

export interface FileExplorerNodeDecoration {
	icon?: ReactNode;
	badge?: string;
	tooltip?: string;
}

export type FileExplorerEntryKind = "file" | "directory";

export interface FileExplorerCreatingEntry {
	parentPath: string;
	kind: FileExplorerEntryKind;
	error: string | null;
	busy: boolean;
}

/** Mouse / keyboard selection gesture for multi-select file trees. */
export interface FileExplorerSelectOptions {
	toggle: boolean;
	range: boolean;
	/** Plain activation (replace selection; open preview / toggle folder). */
	activate: boolean;
}
