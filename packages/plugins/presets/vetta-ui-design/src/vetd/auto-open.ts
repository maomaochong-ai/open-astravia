import type { PluginStorageApi } from "@vetta-org/plugin-sdk";

/** plugin 私有 storage 的键：cwd → 已自动打开过画布。 */
const STORAGE_KEY = "canvas-auto-opened";

/** 同一会话内的短路缓存，避免 conversation-changed 连发时重复读写 storage。 */
const claimedInSession = new Set<string>();

type AutoOpenedMap = Record<string, boolean>;

/**
 * 认领某个项目的「首次自动打开」名额：返回 true 表示这次可以自动展开画布，
 * 之后同一 cwd 永远返回 false（持久化，重启也不再打扰）。
 *
 * storage 读写失败时保守返回 false —— 宁可不自动打开，也不要每次启动都抢面板。
 */
export async function claimCanvasAutoOpen(storage: PluginStorageApi, cwd: string): Promise<boolean> {
	if (claimedInSession.has(cwd)) return false;
	claimedInSession.add(cwd);
	try {
		const opened = (await storage.readJson<AutoOpenedMap>(STORAGE_KEY)) ?? {};
		if (opened[cwd]) return false;
		await storage.writeJson(STORAGE_KEY, { ...opened, [cwd]: true });
		return true;
	} catch {
		return false;
	}
}

/** 仅供测试：清空进程内的认领缓存。 */
export function resetCanvasAutoOpenCache(): void {
	claimedInSession.clear();
}
