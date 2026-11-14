/**
 * 主进程事件循环的阻塞探针。
 *
 * 「活跃会话一跑起来整个应用就转圈/无响应」这类问题，本机没法复现（需要用户那种
 * 几十 MB 的会话与真实项目）。能做的事是把「主线程被谁占住了」变成可回收的证据：
 * 一个不会停的定时器每 100 ms 醒一次，如果实际醒了 300 ms 以上，说明中间有同步工作
 * 把事件循环卡住了——记一条带标签的日志，用户把日志发回来就能定位到具体阶段。
 *
 * 只在开发构建或显式开启时工作，不改变任何业务行为；探针自身成本是每 100 ms 一次
 * 比较，可以忽略。
 */
export interface LoopLagProbeOptions {
	/** 低于这个时长不记，避免把正常的 GC 抖动算进来。 */
	readonly lagThresholdMs?: number;
	readonly intervalMs?: number;
	/** `tag` 是这一段阻塞之前最后一次打的标签，用来区分「谁」把主线程占住了。 */
	readonly onLag: (lagMs: number, tag: string | undefined) => void;
	/** 仅供测试注入。 */
	readonly now?: () => number;
}

export interface LoopLagProbe {
	/** 给当前这一段同步工作打标签；下一条阻塞日志会带上它。 */
	tag(label: string): void;
	stop(): void;
}

const DEFAULT_LAG_THRESHOLD_MS = 300;
const DEFAULT_INTERVAL_MS = 100;

export function startLoopLagProbe(options: LoopLagProbeOptions): LoopLagProbe {
	const now = options.now ?? (() => performance.now());
	const threshold = options.lagThresholdMs ?? DEFAULT_LAG_THRESHOLD_MS;
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

	let expectedAt = now() + intervalMs;
	let currentTag: string | undefined;
	const timer = setInterval(() => {
		const at = now();
		const lag = at - expectedAt;
		expectedAt = at + intervalMs;
		if (lag < threshold) return;
		// 标签只消费一次：下一段阻塞默认是「无标签」，避免把旧标签张冠李戴。
		options.onLag(lag, currentTag);
		currentTag = undefined;
	}, intervalMs);
	// 探针绝不能拖住进程退出。
	timer.unref?.();

	return {
		tag(label: string): void {
			currentTag = label;
		},
		stop(): void {
			clearInterval(timer);
		},
	};
}
