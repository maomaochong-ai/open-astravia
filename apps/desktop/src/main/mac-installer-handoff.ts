import { spawnSync } from "node:child_process";

/**
 * 等待 Squirrel.Mac 把 ShipIt 的 launchd 作业提交完成。
 *
 * 为什么需要这一步，见这条链路上踩过的三个坑：
 *
 *  1. 不标记 `app.isQuitting`：窗口 close 守卫把关闭改成隐藏，而 Squirrel 走
 *     NSApp terminate 语义，任一窗口 preventDefault 就取消整个终止流程 → 应用不退出。
 *  2. 交棒后立刻 `app.exit(0)`：实测 41ms 就把进程打死，Squirrel 连作业都还没提交，
 *     `launchctl print` 里根本没有这个 label → 退出了但版本没变。
 *  3. 交棒后干脆不 exit：本进程挂着 IM sidecar、uiohook、RPC server 等句柄，Electron
 *     的正常退出流程**不会真正结束进程**（原实现用 `app.exit(0)` 正是为此）。而 ShipIt
 *     的 launchd 作业是 `pended nondemand spawn = semaphore`——launchd 要等目标进程
 *     退出才 spawn 它。进程赖活 → ShipIt 永不启动 → 用户以为关了，其实单实例锁又把
 *     老进程的窗口调了出来，看着就是「版本没变」。
 *
 * 因此必须先等作业出现在 launchd 里，再硬 exit：作业已提交 + 进程真的退出，
 * launchd 才会 spawn ShipIt 完成替换。
 */

/**
 * ShipIt 的 launchd 作业 label。必须与 electron-builder 配置里的 `appId` 一致
 * （见 scripts/prepare-pack.js 与 scripts/verify-mac-update.mjs）。
 */
export const MACOS_SHIPIT_JOB_LABEL = "com.vetta.desktop.ShipIt";

export interface InstallerHandoffOptions {
	/** launchd 作业 label，形如 `<bundleId>.ShipIt`。 */
	label: string;
	/** 探测作业是否已提交；默认走 `launchctl list <label>`。 */
	probe?: (label: string) => boolean;
	/** 启动作业；默认走 `launchctl kickstart gui/<uid>/<label>`。 */
	start?: (label: string) => boolean;
	/** 等不到也要放行——退出总比卡住强，ShipIt 下次启动时仍会接着装。 */
	timeoutMs?: number;
	intervalMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INTERVAL_MS = 250;

function launchctlHasJob(label: string): boolean {
	const result = spawnSync("launchctl", ["list", label], { encoding: "utf-8", timeout: 5_000 });
	return result.status === 0;
}

function launchctlKickstart(label: string): boolean {
	const domain = `gui/${process.getuid?.() ?? 0}/${label}`;
	const result = spawnSync("launchctl", ["kickstart", domain], { encoding: "utf-8", timeout: 5_000 });
	return result.status === 0;
}

export type InstallerHandoffResult = "started" | "job-missing" | "start-failed";

/**
 * 等作业出现，然后**主动把它踢起来**，返回结果供调用方记日志。
 *
 * 为什么要主动踢：作业注册的是一个按需启动的 mach service 端点，launchd 只在有人
 * 连上时才 spawn ShipIt。Squirrel 本该在提交作业后连上去，实测它没有——
 * `launchctl print` 里始终是 `port = 0x0, active = 0, runs = 0`，给它几分钟也不变，
 * 且没有任何错误日志。手动 `launchctl kickstart` + 结束应用则能完整装好
 * （ShipIt 日志出现 `Installation completed successfully`）。
 *
 * 因此这里补上这一脚。踢一个已在运行的作业是无害的。
 */
export async function handOffToInstaller(options: InstallerHandoffOptions): Promise<InstallerHandoffResult> {
	const observed = await waitForInstallerHandoff(options);
	if (!observed) return "job-missing";
	const start = options.start ?? launchctlKickstart;
	return start(options.label) ? "started" : "start-failed";
}

/** 返回是否在超时前观察到作业。 */
export async function waitForInstallerHandoff(options: InstallerHandoffOptions): Promise<boolean> {
	const {
		label,
		probe = launchctlHasJob,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		intervalMs = DEFAULT_INTERVAL_MS,
		sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
	} = options;

	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (probe(label)) return true;
		if (Date.now() >= deadline) return false;
		await sleep(intervalMs);
	}
}
