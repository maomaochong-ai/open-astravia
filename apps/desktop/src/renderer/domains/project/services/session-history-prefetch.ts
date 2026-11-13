/**
 * 会话历史预取：鼠标停在同一行上一小会儿，就先把那份历史读进主进程缓存。
 *
 * 为什么值得做：点开一个已有会话时，首屏内容完全取决于一次「读文件 + 解析 + 投影」，
 * 实测 2 MB 会话约 220 ms、6.5 MB 约 2 s。这段等待无法避免，但可以被「悬停」这段时间
 * 吸收掉——用户从悬停到真正按下鼠标通常有 100 ms 以上。
 *
 * 三条纪律：
 * - 只在悬停/聚焦后停留一小段时间才发，划过的行不触发；
 * - 同一路径只预取一次（进程内），失败也记住，不反复打同一个坏文件；
 * - 不改变任何界面状态：预取只写主进程的历史缓存，用户不点就什么都不会显示。
 */
const PREFETCH_DELAY_MS = 120;

const requested = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export interface SessionHistoryPrefetchOptions {
	readonly delayMs?: number;
	/** 仅供测试注入。 */
	readonly readHistory?: (sessionPath: string) => Promise<unknown>;
}

function defaultRead(sessionPath: string): Promise<unknown> {
	return window.astravia.session.openViewer(sessionPath);
}

/** 悬停开始：排队一次预取。 */
export function scheduleSessionHistoryPrefetch(
	sessionPath: string | undefined,
	options: SessionHistoryPrefetchOptions = {},
): void {
	if (!sessionPath || requested.has(sessionPath)) return;
	if (timers.has(sessionPath)) return;
	const delay = options.delayMs ?? PREFETCH_DELAY_MS;
	const timer = setTimeout(() => {
		timers.delete(sessionPath);
		if (requested.has(sessionPath)) return;
		requested.add(sessionPath);
		void (options.readHistory ?? defaultRead)(sessionPath).catch(() => {
			// 预取失败不值得打扰用户：真正点开时会走同一条路径并正常报错。
		});
	}, delay);
	timers.set(sessionPath, timer);
}

/** 悬停结束（鼠标离开/失焦）：还没到时间就取消。 */
export function cancelSessionHistoryPrefetch(sessionPath: string | undefined): void {
	if (!sessionPath) return;
	const timer = timers.get(sessionPath);
	if (!timer) return;
	clearTimeout(timer);
	timers.delete(sessionPath);
}

/** 仅供测试：清空进程内的「已预取」记录。 */
export function resetSessionHistoryPrefetchState(): void {
	for (const timer of timers.values()) clearTimeout(timer);
	timers.clear();
	requested.clear();
}
