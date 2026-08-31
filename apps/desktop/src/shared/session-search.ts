import type { SessionExecutionMode } from "@vetta/runtime-core";
import type { DesktopSessionHistoryInfo } from "./session-access.js";

export type DesktopSessionSearchSourceKind = "conversation" | "claw" | "project" | "batch";

export interface DesktopSessionSearchMatch {
	readonly field: "title" | "userMessage" | "assistantMessage";
	readonly snippet: string;
	readonly entryId?: string;
}

export interface DesktopSessionSearchResult {
	readonly session: DesktopSessionHistoryInfo;
	/** Sidebar bucket cwd; default conversations must not use their per-session working cwd here. */
	readonly sourceCwd: string;
	readonly sourceKind: DesktopSessionSearchSourceKind;
	readonly sourceName?: string;
	readonly executionMode?: SessionExecutionMode;
	readonly match: DesktopSessionSearchMatch;
}

export interface DesktopSessionSearchRequest {
	readonly query: string;
	readonly limit?: number;
	readonly sourceKind?: DesktopSessionSearchSourceKind;
	readonly projectCwd?: string;
	/** Inclusive lower bound for the catalog's last-message activity time, in epoch milliseconds. */
	readonly modifiedFrom?: number;
	/** Exclusive upper bound; the renderer converts an inclusive end date to the next local midnight. */
	readonly modifiedBefore?: number;
}

export interface DesktopSessionSearchSource {
	readonly cwd: string;
	readonly kind: DesktopSessionSearchSourceKind;
	readonly name?: string;
}

export interface DesktopSessionSearchEvent {
	readonly requestId: string;
	/** Incremental candidates. Merge by session path and retain the newest request.limit results. */
	readonly results?: DesktopSessionSearchResult[];
	readonly sources?: DesktopSessionSearchSource[];
	readonly done: boolean;
	readonly limited?: boolean;
	readonly skipped?: number;
	readonly error?: "search-failed";
}

export const SESSION_SEARCH_CHANNELS = {
	start: "vetta:session:search-sessions",
	cancel: "vetta:session:cancel-search",
	event: "vetta:session:search-sessions-event",
} as const;
