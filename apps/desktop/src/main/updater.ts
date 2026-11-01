import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAstraviaHomePath } from "@astravia/action-rpc";
import { app, autoUpdater as nativeAutoUpdater, powerMonitor } from "electron";
import electronUpdater from "electron-updater";

import { mainT } from "./i18n/index.js";
import {
	InnoWindowsUpdateController,
	isVersionedWindowsExecutable,
	resolveInnoUpdateStoreRoot,
} from "./inno-windows-update.js";
import { handOffToInstaller, MACOS_SHIPIT_JOB_LABEL } from "./mac-installer-handoff.js";
import { inspectMacBundleSignature } from "./mac-unsigned-installer.js";
import { runQuitCleanup } from "./quit-cleanup.js";
import { markPendingUpdateRelaunch } from "./update-relaunch-marker.js";
import { ElectronUpdaterEngine, type UpdateHandoffResult, type UpdateInstallMode } from "./updater-engine.js";
import { type UpdaterPhase, UpdaterService, type UpdaterState } from "./updater-service.js";
import { scheduleWindowsQuitWatchdog } from "./windows-quit-watchdog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Windows 后台更新的退出宽限：正常 quit 才会 spawn relauncher，但 sidecar 句柄
 * 可能把退出拖死，超过这个时长就硬退（此时 relaunch 已失效，指针留到下次启动）。
 */
const WINDOWS_QUIT_WATCHDOG_MS = 8_000;

/**
 * 看门狗兜底用的拉起路径：直接 spawn 版本目录里的可执行文件，而不再经过
 * `app.relaunch()`——硬退路径不保证它还能 spawn。新进程会在单实例锁上有限重试，
 * 所以旧进程还没完全退出也不会把它挤掉。
 */
function startWindowsUpdateTarget(executablePath: string | undefined): boolean {
	if (!executablePath) return false;
	spawn(executablePath, process.argv.slice(1), { detached: true, stdio: "ignore" }).unref();
	return true;
}

export type { UpdaterPhase, UpdaterState };

export function getAppVersion(): string {
	return app.isPackaged
		? app.getVersion()
		: (JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")).version as string);
}

// electron-updater 是 CommonJS 包；主进程产物为 ESM 且将它 externalize，
// 因此必须从默认导出解构，不能保留 ESM 命名导入。
const { autoUpdater } = electronUpdater;

/**
 * Packaged E2E runs against an explicitly supplied test feed. Keeping this
 * override behind the E2E marker prevents runtime environment variables from
 * changing the update source in production builds.
 */
function configureE2eUpdateFeed(): void {
	if (!app.isPackaged || process.env.ASTRAVIA_E2E !== "1") return;
	const feedUrl = process.env.ASTRAVIA_E2E_UPDATE_URL?.trim();
	if (!feedUrl) return;
	try {
		const parsedUrl = new URL(feedUrl);
		const isLocalHttp =
			parsedUrl.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname);
		if (parsedUrl.protocol !== "https:" && !isLocalHttp) {
			console.warn("[updater] ignored insecure or unsupported E2E update feed");
			return;
		}
		if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
			console.warn("[updater] ignored E2E update feed with credentials or URL decorations");
			return;
		}
		autoUpdater.setFeedURL({
			provider: "generic",
			url: feedUrl,
			useMultipleRangeRequest: true,
		});
		console.info(`[updater] E2E update feed configured: ${feedUrl}`);
	} catch (error) {
		console.error("[updater] failed to configure E2E update feed", error);
	}
}

configureE2eUpdateFeed();
const currentVersion = getAppVersion();
const innoWindowsUpdate =
	process.platform === "win32" && app.isPackaged && isVersionedWindowsExecutable(process.execPath, currentVersion)
		? new InnoWindowsUpdateController({
				currentVersion,
				storeRoot: resolveInnoUpdateStoreRoot(),
				relaunch: (executablePath) => {
					app.relaunch({ execPath: executablePath, args: process.argv.slice(1) });
				},
				quit: () => app.quit(),
			})
		: undefined;
const nativeMacUpdateEvents =
	process.platform === "darwin"
		? {
				onUpdateDownloaded: (listener: () => void) => {
					nativeAutoUpdater.on("update-downloaded", listener);
					return () => nativeAutoUpdater.off("update-downloaded", listener);
				},
				onError: (listener: (error: Error) => void) => {
					nativeAutoUpdater.on("error", listener);
					return () => nativeAutoUpdater.off("error", listener);
				},
			}
		: undefined;
/** `getAppPath()` 在打包后指向 `Contents/Resources/app.asar`，不是 bundle 本身。 */
function resolveMacBundlePath(): string {
	// 可执行文件固定是 `Contents/MacOS/<name>`，向上三级才是 `<name>.app`。
	return dirname(dirname(dirname(app.getPath("exe"))));
}

/**
 * 未签名（adhoc / linker-signed）包不能交给 Squirrel.Mac：它替换前会用当前包的
 * 指定要求校验新包，而这类包连 CodeResources 都不完整，校验必然失败。此时改走
 * 内置安装器（解包 + 原地替换），否则用户点多少次「更新」都停在同一个版本。
 *
 * 探针只决定**先用哪条路**，不决定「能不能装」：即便它漏判，交棒失败（job-missing）
 * 时引擎仍会回退到内置安装器。
 */
const macBundlePath = process.platform === "darwin" ? resolveMacBundlePath() : undefined;
const macSignature = macBundlePath ? inspectMacBundleSignature(macBundlePath) : undefined;
const macInstallTarget =
	macBundlePath && app.isPackaged
		? {
				appPath: macBundlePath,
				cacheRoot: join(homedir(), "Library", "Caches", "astravia-updater"),
				preferBuiltIn: macSignature?.unsigned === true,
			}
		: undefined;

// 交棒前：标记 isQuitting（窗口 close 守卫只有看到它才真正销毁窗口），并跑完退出清理。
const prepareQuit = async () => {
	(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
	// 安装器会以守护进程身份把应用拉回来，那样起来的窗口不会自动到前台，
	// 打个标记让下次启动主动抢焦点（见 update-relaunch-marker.ts）。
	markPendingUpdateRelaunch(getAstraviaHomePath());
	// 探针结论要在这里落日志：模块初始化时 logger sink 还没装好，会整行丢掉。
	if (macSignature) {
		console.info(
			`[updater] macOS bundle signature: ${macSignature.unsigned ? "unsigned" : "signed"} (${macSignature.reason}); install path: ${macInstallTarget?.preferBuiltIn ? "built-in first" : "squirrel first"}`,
		);
	}
	console.info("[updater] running quit cleanup before handing off to the installer");
	await runQuitCleanup();
};
// 交棒后：等 Squirrel 把 ShipIt 的 launchd 作业提交上去，再硬结束本进程——
// 本进程挂着 sidecar 等句柄不会自行退出，而 launchd 要等目标退出才 spawn ShipIt。
// 三种失败模式与取舍见 mac-installer-handoff.ts。
//
// 返回值决定谁负责退出：
// - Windows 后台更新必须走正常 quit 流程，`app.relaunch()` 只在 quit 路径 spawn，
//   以前在这里直接 `app.exit(0)` 会把刚登记的 relaunch 整个吞掉，指针指向新版但
//   新进程从未启动；用户重开时 launcher 又按 pending 把它回滚成旧版。
// - macOS 交棒失败（`job-missing`）时返回 unavailable，让引擎改用内置安装器，
//   而不是像旧实现那样什么也没装就退出。
const handOff = async (mode: UpdateInstallMode): Promise<UpdateHandoffResult> => {
	if (process.platform === "win32" && mode === "windows-inno") {
		// 兜底：正常退出流程也可能被 sidecar 句柄拖死。硬退不会替我们 spawn
		// `app.relaunch` 的目标，所以看门狗先自己拉起新版再退（见 windows-quit-watchdog.ts）。
		scheduleWindowsQuitWatchdog({
			timeoutMs: WINDOWS_QUIT_WATCHDOG_MS,
			relaunch: () => startWindowsUpdateTarget(innoWindowsUpdate?.preparedExecutablePath()),
			exit: () => app.exit(0),
		});
		app.quit();
		return "exiting";
	}
	if (process.platform === "darwin" && mode === "mac-squirrel") {
		const result = await handOffToInstaller({ label: MACOS_SHIPIT_JOB_LABEL });
		console.info(`[updater] installer handoff: ${result}`);
		return result === "started" ? "started" : "unavailable";
	}
	return "started";
};

const exitForInstall = (code: number) => {
	app.exit(code);
};

const updaterEngine = new ElectronUpdaterEngine(
	autoUpdater,
	innoWindowsUpdate,
	nativeMacUpdateEvents,
	{
		prepare: prepareQuit,
		handOff,
		exit: exitForInstall,
	},
	macInstallTarget,
);
// powerMonitor 只能在 app ready 之后订阅，因此这里只传订阅函数，
// 由 UpdaterService.onAppReady() 在合适的时机调用。
const systemEvents = {
	onResume: (listener: () => void) => {
		powerMonitor.on("resume", listener);
		return () => powerMonitor.off("resume", listener);
	},
};
export const updaterService = new UpdaterService(updaterEngine, currentVersion, app.isPackaged, mainT, {
	systemEvents,
});

interface UpgradeE2eState {
	phase: "pending" | "checking" | "available" | "downloading" | "installing" | "verified" | "failed";
	baselineVersion: string;
	expectedVersion: string;
	currentVersion?: string;
	latestVersion?: string;
	error?: string;
	updatedAt: string;
}

function upgradeE2eStatePaths(): string[] {
	return [
		process.env.ASTRAVIA_E2E_UPGRADE_STATE?.trim(),
		join(getAstraviaHomePath(), "desktop-upgrade-e2e.json"),
		// ShipIt can relaunch without the test environment. Keep one fallback marker
		// under the runner user's normal Astravia home so the second process can find it.
		join(homedir(), ".astravia", "desktop-upgrade-e2e.json"),
	].filter((path, index, paths): path is string => Boolean(path) && paths.indexOf(path) === index);
}

async function readUpgradeE2eState(paths: readonly string[]): Promise<{ path: string; state: UpgradeE2eState } | null> {
	for (const path of paths) {
		try {
			const value: unknown = JSON.parse(await readFile(path, "utf8"));
			if (!value || typeof value !== "object") continue;
			const state = value as Partial<UpgradeE2eState>;
			if (!state.baselineVersion || !state.expectedVersion || !state.phase) continue;
			return { path, state: state as UpgradeE2eState };
		} catch {
			// Try the next marker location; a macOS relaunch may only see the fallback.
		}
	}
	return null;
}

async function writeUpgradeE2eState(
	paths: readonly string[],
	state: Omit<UpgradeE2eState, "updatedAt">,
): Promise<void> {
	const body = `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`;
	await Promise.all(
		paths.map(async (path) => {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, body, "utf8");
		}),
	);
}

/**
 * Drive the real updater from a packaged app for the cross-platform release gate.
 * The marker file is deliberately opt-in and is never created by production code.
 */
export async function runUpgradeE2e(): Promise<void> {
	if (!app.isPackaged) return;
	const statePaths = upgradeE2eStatePaths();
	const marker = await readUpgradeE2eState(statePaths);
	if (!marker) return;
	const { state } = marker;
	if (state.phase === "verified" || state.phase === "failed") return;
	if (state.phase === "installing") {
		const updatedAt = Date.parse(state.updatedAt ?? "");
		if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 30 * 60 * 1000) return;
	}
	// ShipIt may start the relaunched macOS process without inheriting the shell
	// environment. The persisted installing marker is the only second-launch opt-in.
	if (process.env.ASTRAVIA_E2E !== "1" && state.phase !== "installing") return;

	const current = getAppVersion();
	if (state.phase === "installing") {
		if (current !== state.expectedVersion) {
			await writeUpgradeE2eState(statePaths, {
				...state,
				phase: "failed",
				currentVersion: current,
				error: `relaunch returned version ${current}, expected ${state.expectedVersion}`,
			});
			return;
		}
		await writeUpgradeE2eState(statePaths, { ...state, phase: "verified", currentVersion: current });
		setTimeout(() => app.exit(0), 500).unref?.();
		return;
	}

	if (current !== state.baselineVersion) {
		await writeUpgradeE2eState(statePaths, {
			...state,
			phase: "failed",
			currentVersion: current,
			error: `baseline started at ${current}, expected ${state.baselineVersion}`,
		});
		return;
	}

	try {
		await writeUpgradeE2eState(statePaths, { ...state, phase: "checking", currentVersion: current });
		const checked = await updaterService.check();
		if (checked.phase !== "available" || checked.latestVersion !== state.expectedVersion) {
			throw new Error(`feed returned ${checked.latestVersion ?? "no update"}, expected ${state.expectedVersion}`);
		}
		await writeUpgradeE2eState(statePaths, {
			...state,
			phase: "available",
			currentVersion: current,
			latestVersion: checked.latestVersion,
		});
		const downloaded = await updaterService.startDownload();
		if (downloaded.phase !== "ready") {
			throw new Error(`download ended in phase ${downloaded.phase}`);
		}
		await writeUpgradeE2eState(statePaths, {
			...state,
			phase: "installing",
			currentVersion: current,
			latestVersion: downloaded.latestVersion,
		});
		await updaterService.install();
		const finalState = updaterService.getState();
		if (finalState.phase !== "installing") {
			throw new Error(`install ended in phase ${finalState.phase}`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[updater-e2e] upgrade failed", error);
		await writeUpgradeE2eState(statePaths, {
			...state,
			phase: "failed",
			currentVersion: current,
			error: message,
		});
	}
}
