/**
 * Windows 后台更新的退出看门狗。
 *
 * `app.relaunch()` 登记的重启只在正常 quit 流程里 spawn；一旦退出被 sidecar 句柄
 * 拖住，就必须硬退，而硬退之后未必还有新进程被拉起——用户看到的就是「点了重启，
 * 应用没回来，版本其实已经换好」。
 *
 * 因此看门狗触发时不等 Electron：先自己把新版可执行文件拉起来，再硬退。新进程会在
 * 单实例锁上有限重试（见 single-instance-lock.ts），所以这里不等旧进程消失也安全。
 */

export interface WindowsQuitWatchdogOptions {
	timeoutMs: number;
	/** 拉起新版；返回 false 表示没有可拉起的路径（例如尚未准备好）。 */
	relaunch: () => boolean;
	/** 硬退出当前进程。 */
	exit: () => void;
	log?: (message: string) => void;
	/** 测试注入。 */
	schedule?: (callback: () => void, delayMs: number) => void;
}

export function scheduleWindowsQuitWatchdog(options: WindowsQuitWatchdogOptions): void {
	const log = options.log ?? ((message: string) => console.warn(message));
	const schedule =
		options.schedule ??
		((callback: () => void, delayMs: number) => {
			setTimeout(callback, delayMs).unref?.();
		});

	schedule(() => {
		log(`[updater] quit watchdog fired after ${options.timeoutMs}ms, starting the new version before exiting`);
		try {
			if (!options.relaunch()) log("[updater] no prepared Windows executable to launch");
		} catch (error) {
			log(`[updater] watchdog relaunch failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		options.exit();
	}, options.timeoutMs);
}
