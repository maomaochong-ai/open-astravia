/**
 * 插件工作区（含侧栏默认置顶的设计画廊）与内置 surface 分开记账：
 * 视图身份来自 URL，数量不固定，所以用 LRU 而不是「访问过就永远挂着」。
 */
export interface WorkspaceSurfaceRef {
	readonly pluginId: string;
	readonly viewId: string;
	/** `${pluginId}/${viewId}`，解码后的稳定身份。 */
	readonly key: string;
}

/** 与空闲会话驻留上限同量级：最近用过的工作区立刻切回，更早的卸树。 */
export const MAX_RESIDENT_WORKSPACE_SURFACES = 3;

const WORKSPACE_PATH = /^\/workspace\/([^/]+)\/([^/]+)\/?$/;

export function workspaceSurfaceForPath(pathname: string): WorkspaceSurfaceRef | null {
	const path = pathname === "" ? "/" : pathname;
	const match = WORKSPACE_PATH.exec(path);
	if (!match?.[1] || !match[2]) return null;
	let pluginId: string;
	let viewId: string;
	try {
		pluginId = decodeURIComponent(match[1]);
		viewId = decodeURIComponent(match[2]);
	} catch {
		return null;
	}
	if (!pluginId || !viewId) return null;
	return { pluginId, viewId, key: `${pluginId}/${viewId}` };
}

export function rememberVisitedWorkspace(
	visited: readonly WorkspaceSurfaceRef[],
	next: WorkspaceSurfaceRef | null,
): readonly WorkspaceSurfaceRef[] {
	if (!next) return visited;
	const last = visited[visited.length - 1];
	if (last?.key === next.key) return visited;
	const without = visited.filter((item) => item.key !== next.key);
	const stacked = [...without, next];
	if (stacked.length <= MAX_RESIDENT_WORKSPACE_SURFACES) return stacked;
	return stacked.slice(-MAX_RESIDENT_WORKSPACE_SURFACES);
}
