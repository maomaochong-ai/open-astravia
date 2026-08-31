import type { DesktopSessionHistoryInfo } from "./session-access.js";
import type { DesktopSessionSearchResult } from "./session-search.js";

export const MAX_SESSION_SEARCH_RESULTS = 100;

export function compareSearchSessions(
	left: Pick<DesktopSessionHistoryInfo, "modifiedAt" | "path">,
	right: Pick<DesktopSessionHistoryInfo, "modifiedAt" | "path">,
): number {
	const leftTime = Number.isFinite(left.modifiedAt) ? left.modifiedAt : 0;
	const rightTime = Number.isFinite(right.modifiedAt) ? right.modifiedAt : 0;
	return rightTime - leftTime || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export function mergeSessionSearchResults(
	previous: readonly DesktopSessionSearchResult[],
	incoming: readonly DesktopSessionSearchResult[],
	limit = MAX_SESSION_SEARCH_RESULTS,
): DesktopSessionSearchResult[] {
	return [...new Map([...previous, ...incoming].map((result) => [result.session.path, result])).values()]
		.sort((left, right) => compareSearchSessions(left.session, right.session))
		.slice(0, limit);
}
