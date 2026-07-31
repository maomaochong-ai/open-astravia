import type { ReactNode } from "react";

/** Plain filesystem entry for tree UI (no desktop store dependency). */
export interface FileExplorerEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	modifiedAt: number;
}

export interface FileExplorerNodeDecoration {
	icon?: ReactNode;
	badge?: string;
	tooltip?: string;
}
