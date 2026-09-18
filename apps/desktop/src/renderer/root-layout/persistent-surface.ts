import { isChatSurfacePath } from "./isChatSurfacePath";

/**
 * 侧栏高频入口对应的工作台 surface。这些页走 keep-alive，不走 Outlet 卸树。
 * 插件工作区由 `workspace-surface.ts` 另记 LRU；团队会话、项目详情、查看器和主题页同款 LRU。
 * 聊天路径分类见 `isChatSurfacePath`；未登记的产品路由才落到 Outlet。
 */
export type PersistentSurfaceId =
	| "abilities"
	| "agents"
	| "automation"
	| "batch-tasks"
	| "chat"
	| "knowledge"
	| "knowledge-all"
	| "new-session"
	| "scenes"
	| "settings";

export function persistentSurfaceIdForPath(pathname: string): PersistentSurfaceId | null {
	const path = pathname === "" ? "/" : pathname;
	if (path === "/knowledge/all" || path.startsWith("/knowledge/all/")) return "knowledge-all";
	if (path === "/knowledge" || path.startsWith("/knowledge/")) return "knowledge";
	if (path === "/abilities" || path.startsWith("/abilities/")) return "abilities";
	if (path === "/agents" || path.startsWith("/agents/")) return "agents";
	if (path === "/scenes" || path.startsWith("/scenes/")) return "scenes";
	if (path === "/automation" || path.startsWith("/automation/")) return "automation";
	if (path === "/batch-tasks" || path.startsWith("/batch-tasks/")) return "batch-tasks";
	if (path === "/settings" || path.startsWith("/settings/")) return "settings";
	if (path === "/new-session" || path.startsWith("/new-session/")) return "new-session";
	if (isChatSurfacePath(path)) return "chat";
	return null;
}

export function rememberVisitedSurface(
	visited: ReadonlySet<PersistentSurfaceId>,
	surface: PersistentSurfaceId | null,
): ReadonlySet<PersistentSurfaceId> {
	if (!surface || visited.has(surface)) return visited;
	const next = new Set(visited);
	next.add(surface);
	return next;
}
