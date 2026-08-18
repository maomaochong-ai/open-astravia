import { atom } from "jotai";
import { activityPanelOpenAtom, activityPanelTabByProjectAtom, setActivityPanelWidthAtom } from "./activity-atoms";
import { activeSessionAtom } from "./chat-atoms";

/**
 * 会话级内置浏览器：每会话（按 sessionPath）当前预览的 URL。
 * 仅内存存活——切走再切回同一会话仍在（webview 跨活动 tab 保活），App 重启清空。
 */
export const browserUrlBySessionAtom = atom<Map<string, string>>(new Map<string, string>());

export function getBrowserUrlForSession(map: Map<string, string>, sessionPath: string | null): string | null {
	return sessionPath ? (map.get(sessionPath) ?? null) : null;
}

/** 在当前会话的内置浏览器里打开 URL：写入预览地址 + 展开面板 + 切到浏览器 tab。 */
export const openUrlInBrowserAtom = atom(null, (get, set, url: string) => {
	const session = get(activeSessionAtom);
	if (!session) return;
	set(browserUrlBySessionAtom, (prev) => {
		const next = new Map(prev);
		next.set(session.sessionPath, url);
		return next;
	});
	set(activityPanelOpenAtom, true);
	// 从会话链接展开浏览器时默认拉到最大宽度，给预览页面足够空间。
	set(setActivityPanelWidthAtom, "max");
	set(activityPanelTabByProjectAtom, (prev) => new Map(prev).set(session.cwd, "browser"));
});

/** 回写某会话浏览器实际导航到的 URL（webview 内部跳转后同步，用于地址栏与会话记忆）。 */
export const setBrowserUrlForSessionAtom = atom(null, (_get, set, payload: { sessionPath: string; url: string }) => {
	set(browserUrlBySessionAtom, (prev) => {
		const next = new Map(prev);
		next.set(payload.sessionPath, payload.url);
		return next;
	});
});
