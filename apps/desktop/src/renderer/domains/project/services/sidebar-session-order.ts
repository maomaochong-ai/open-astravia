import type { PinnedSessionPaths, SessionInfo } from "@shared/store/atoms";

export interface SidebarSessionOrdering {
	all: SessionInfo[];
	hasMore: boolean;
	hiddenCount: number;
	visible: SessionInfo[];
}

export function orderSidebarSessions(sessions: readonly SessionInfo[], pinnedPaths: PinnedSessionPaths): SessionInfo[] {
	return [...sessions].sort((left, right) => {
		const leftPinnedAt = pinnedPaths.get(left.path);
		const rightPinnedAt = pinnedPaths.get(right.path);
		if (leftPinnedAt !== undefined || rightPinnedAt !== undefined) {
			if (leftPinnedAt === undefined) return 1;
			if (rightPinnedAt === undefined) return -1;
			if (leftPinnedAt !== rightPinnedAt) return rightPinnedAt - leftPinnedAt;
		}
		return right.modifiedAt - left.modifiedAt;
	});
}

export function buildSidebarSessionOrdering(
	sessions: readonly SessionInfo[],
	pinnedPaths: PinnedSessionPaths,
	defaultVisibleCount: number,
	showAll: boolean,
): SidebarSessionOrdering {
	const all = orderSidebarSessions(sessions, pinnedPaths);
	const pinnedCount = all.findIndex((session) => !pinnedPaths.has(session.path));
	const minimumVisible = pinnedCount === -1 ? all.length : pinnedCount;
	const collapsedCount = Math.max(defaultVisibleCount, minimumVisible);
	const visible = showAll ? all : all.slice(0, collapsedCount);
	return {
		all,
		hasMore: all.length > collapsedCount,
		hiddenCount: Math.max(0, all.length - visible.length),
		visible,
	};
}
