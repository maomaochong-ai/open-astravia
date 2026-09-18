/**
 * 切到已经挂着的保活页时，离场页不必再叠一帧：目标页上一帧还在，盖上去只会挡住标题。
 * 第一次走进（树里还没有）才叠离场帧，避免主区闪空白。
 */
export function incomingKeepAliveAlreadyMounted(input: {
	surface: string | null;
	visited: ReadonlySet<string>;
	workspace: { key: string } | null;
	visitedWorkspaces: readonly { key: string }[];
	teamChat: { teamId: string } | null;
	visitedTeamChats: readonly { teamId: string }[];
	detail?: { key: string } | null;
	visitedDetails?: readonly { key: string }[];
}): boolean {
	if (input.surface) return input.visited.has(input.surface);
	if (input.workspace) return input.visitedWorkspaces.some((item) => item.key === input.workspace?.key);
	if (input.teamChat) return input.visitedTeamChats.some((item) => item.teamId === input.teamChat?.teamId);
	if (input.detail) return (input.visitedDetails ?? []).some((item) => item.key === input.detail?.key);
	return false;
}
