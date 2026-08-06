/**
 * 退出前的优雅清理（IM sidecar、运行时文件锁、本地 RPC、全局键盘监听…）。
 *
 * 单独成模块而不是留在 main.ts 的 `before-quit` 里，是因为**更新安装必须先跑完
 * 清理、再把终止时机交给 Squirrel.Mac**：
 *
 * `before-quit` 的实现是 `preventDefault()` → 异步清理 → `app.exit(0)`。硬 exit
 * 会在 Squirrel 的 `relaunchToInstallUpdate` 异步链（写状态 → 校验更新包 → 经
 * launchd 拉起 ShipIt → 终止 app）走到「拉起 ShipIt」之前就打死进程，实测整个
 * 清理只用 41ms，ShipIt 从未被 spawn，用户看到「点了重启，应用关了，但还是旧
 * 版本」。原生 Electron 没有这个 handler，所以标准更新流程是能work的。
 *
 * 因此更新路径调用 {@link runQuitCleanup} 自行完成清理，此后 `before-quit` 直通
 * （不 preventDefault、不 exit），进程的终止时机由 Squirrel 决定。
 */

export type QuitCleanup = () => Promise<void>;

let cleanup: QuitCleanup | undefined;
let started = false;

/** main.ts 在启动时注册真正的清理实现。 */
export function setQuitCleanup(fn: QuitCleanup): void {
	cleanup = fn;
}

/** 清理是否已经开始（或完成）。`before-quit` 据此决定是否还要接管退出流程。 */
export function isQuitCleanupStarted(): boolean {
	return started;
}

/** 幂等：重复调用只会执行一次。 */
export async function runQuitCleanup(): Promise<void> {
	if (started) return;
	started = true;
	await cleanup?.();
}

/** 仅供测试重置模块级状态。 */
export function resetQuitCleanupForTest(): void {
	cleanup = undefined;
	started = false;
}
