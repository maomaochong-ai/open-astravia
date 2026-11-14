export interface LastActiveSession {
	cwd: string;
	sessionPath: string;
}

export const LAST_ACTIVE_SESSION_STORAGE_KEY = "astravia-last-active-session";

/**
 * localStorage 只在 renderer 里存在。
 *
 * 这个模块会被纯 Node 环境（单元测试、SSR 式渲染）间接 import，因此不能直接写
 * `localStorage.xxx`：`catch` 里再访问一次会让「没有 storage」这条路径自身抛错，
 * 把一个可恢复的读失败升级成模块加载失败。
 */
function storage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function readLastActiveSession(): LastActiveSession | null {
	const store = storage();
	if (!store) return null;
	try {
		const raw = store.getItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<LastActiveSession>;
		if (typeof value.cwd !== "string" || !value.cwd || typeof value.sessionPath !== "string" || !value.sessionPath) {
			store.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
			return null;
		}
		return { cwd: value.cwd, sessionPath: value.sessionPath };
	} catch {
		store.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
		return null;
	}
}
