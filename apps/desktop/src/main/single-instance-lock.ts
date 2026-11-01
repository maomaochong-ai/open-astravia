/**
 * 单实例锁的有限重试。
 *
 * 更新交棒后，新进程可能在旧进程还没释放锁的时候就已经启动：Electron 在 shutdown
 * 期间才 spawn `app.relaunch` 的目标，Windows 上更会在退出流程被卡住时由看门狗自行
 * 拉起新版本。此时若立刻放弃，新进程走 `app.exit(0)` 静默消失——用户看到的就是
 * 「点了重启，桌面没有应用」。
 *
 * 所以只在「本次启动由更新重启触发」时重试：普通二次启动立刻放弃，交给旧实例的
 * `second-instance` 去聚焦已有窗口。
 */

export interface AcquireSingleInstanceLockOptions {
	/** 本次启动是否由更新重启触发；为 false 时只尝试一次。 */
	retry: boolean;
	timeoutMs?: number;
	intervalMs?: number;
	/** 测试注入：同步睡眠与时钟，避免真实等待。 */
	sleep?: (ms: number) => void;
	now?: () => number;
}

export const SINGLE_INSTANCE_RETRY_TIMEOUT_MS = 15_000;
export const SINGLE_INSTANCE_RETRY_INTERVAL_MS = 250;

/** 主进程在 ready 之前的同步睡眠。Atomics.wait 不依赖事件循环。 */
export function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquireSingleInstanceLockWithRetry(
	acquire: () => boolean,
	options: AcquireSingleInstanceLockOptions,
): boolean {
	if (acquire()) return true;
	if (!options.retry) return false;

	const timeoutMs = options.timeoutMs ?? SINGLE_INSTANCE_RETRY_TIMEOUT_MS;
	const intervalMs = options.intervalMs ?? SINGLE_INSTANCE_RETRY_INTERVAL_MS;
	const sleep = options.sleep ?? sleepSync;
	const now = options.now ?? Date.now;
	const deadline = now() + timeoutMs;
	while (now() < deadline) {
		sleep(intervalMs);
		if (acquire()) return true;
	}
	return false;
}
