import type { RuntimeSessionAccess, SessionHistoryInfo } from "@vetta/runtime-core";

export interface DesktopSessionHistoryInfo extends SessionHistoryInfo {
	readonly access: RuntimeSessionAccess;
}

export type DesktopSessionOpenTarget = "interactive" | "viewer" | "unavailable";

export const UNAVAILABLE_RUNTIME_SESSION_ACCESS: RuntimeSessionAccess = {
	readHistory: false,
	interactiveResume: false,
	rename: false,
	delete: false,
};

export function resolveDesktopSessionOpenTarget(access: RuntimeSessionAccess): DesktopSessionOpenTarget {
	if (access.interactiveResume) return "interactive";
	if (access.readHistory) return "viewer";
	return "unavailable";
}
