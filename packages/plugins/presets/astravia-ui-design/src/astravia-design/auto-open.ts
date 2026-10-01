/**
 * 最近一次认领过自动打开的会话 runtimeId。conversation-changed 会因流式状态等
 * 原因对同一会话连发，靠它保证「一次会话打开只抢一次面板」；切到别的会话再切回
 * 视为一次新的打开，重新认领。
 */
let lastClaimedSessionId: string | null = null;

/**
 * 认领某次「会话打开」的自动展开名额：每次切入新会话（含来回切换）返回 true，
 * 同一会话的重复事件返回 false——用户在会话内关掉面板后不再反复弹。
 */
export function claimCanvasAutoOpen(sessionId: string | null): boolean {
	if (!sessionId || sessionId === lastClaimedSessionId) return false;
	lastClaimedSessionId = sessionId;
	return true;
}

/** 仅供测试：清空进程内的认领状态。 */
export function resetCanvasAutoOpenCache(): void {
	lastClaimedSessionId = null;
}

/**
 * 先把画布 chunk 取回求值，再翻开面板。画布 Tab 是懒加载的：直接开面板的话，
 * chunk 的解析、求值与首帧渲染全压在面板滑出动画那 200ms 里，主线程一停，动画
 * 就卡在半路。预热失败（离线、包损坏）不拦打开——面板照常开，让 React lazy 那
 * 条路去报错；预热期间会话已经切走则放弃，别把画布开到别人的面板里。
 */
export async function openCanvasAfterWarmup(
	warm: () => Promise<unknown>,
	isStale: () => boolean,
	open: () => void,
): Promise<void> {
	await warm().catch(() => undefined);
	if (isStale()) return;
	open();
}
