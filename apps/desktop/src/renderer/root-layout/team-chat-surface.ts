/**
 * Agent Team 会话与主对话分开记账：身份来自 URL，数量不固定，用 LRU 保活最近几个团队。
 */
export interface TeamChatSurfaceRef {
	readonly teamId: string;
	readonly sessionId?: string;
	readonly memberId?: string;
}

/** 同时保活的团队会话上限：切回最近用过的团队不必卸树。 */
export const MAX_RESIDENT_TEAM_CHATS = 2;

const TEAM_CHAT_PATH = /^\/agent-teams\/([^/]+)(?:\/sessions\/([^/]+)(?:\/members\/([^/]+))?)?\/?$/;

export function teamChatSurfaceForPath(pathname: string): TeamChatSurfaceRef | null {
	const path = pathname === "" ? "/" : pathname;
	if (path === "/agent-teams" || path.endsWith("/new") || path.endsWith("/settings")) return null;
	const match = TEAM_CHAT_PATH.exec(path);
	if (!match?.[1]) return null;
	try {
		const teamId = decodeURIComponent(match[1]);
		if (!teamId) return null;
		const sessionId = match[2] ? decodeURIComponent(match[2]) : undefined;
		const memberId = match[3] ? decodeURIComponent(match[3]) : undefined;
		return { teamId, sessionId, memberId };
	} catch {
		return null;
	}
}

export function rememberVisitedTeamChat(
	visited: readonly TeamChatSurfaceRef[],
	next: TeamChatSurfaceRef | null,
): readonly TeamChatSurfaceRef[] {
	if (!next) return visited;
	const last = visited[visited.length - 1];
	if (last?.teamId === next.teamId && last.sessionId === next.sessionId && last.memberId === next.memberId) {
		return visited;
	}
	const without = visited.filter((item) => item.teamId !== next.teamId);
	const stacked = [...without, next];
	if (stacked.length <= MAX_RESIDENT_TEAM_CHATS) return stacked;
	return stacked.slice(-MAX_RESIDENT_TEAM_CHATS);
}
