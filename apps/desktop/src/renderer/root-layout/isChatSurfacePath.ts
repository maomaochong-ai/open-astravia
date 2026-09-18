/**
 * 主对话页（`/` 与未匹配路由）由 PersistentRouteStage 里的聊天保活面承载。
 * 已登记的产品前缀走对应保活 surface；这里只负责把「不是聊天」的路径剔出去。
 */
const NON_CHAT_PREFIXES = [
	"/abilities",
	"/agent-teams",
	"/agents",
	"/automation",
	"/batch-tasks",
	"/knowledge",
	"/new-session",
	"/plugins",
	"/project",
	"/scenes",
	"/settings",
	"/skills",
	"/theme",
	"/viewer",
	"/workspace",
] as const;

export function isChatSurfacePath(pathname: string): boolean {
	const path = pathname === "" ? "/" : pathname;
	if (path === "/") return true;
	return !NON_CHAT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
