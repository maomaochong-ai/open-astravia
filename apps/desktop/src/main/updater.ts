import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getVettaHomePath } from "@vetta/action-rpc";
import { app, autoUpdater as nativeAutoUpdater, powerMonitor } from "electron";
import electronUpdater from "electron-updater";

import { mainT } from "./i18n/index.js";
import {
	InnoWindowsUpdateController,
	isVersionedWindowsExecutable,
	resolveInnoUpdateStoreRoot,
} from "./inno-windows-update.js";
import { handOffToInstaller, MACOS_SHIPIT_JOB_LABEL } from "./mac-installer-handoff.js";
import { runQuitCleanup } from "./quit-cleanup.js";
import { markPendingUpdateRelaunch } from "./update-relaunch-marker.js";
import { ElectronUpdaterEngine } from "./updater-engine.js";
import { type UpdaterPhase, UpdaterService, type UpdaterState } from "./updater-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
	if (!app.isPackaged || process.env.VETTA_E2E !== "1") return;
	const feedUrl = process.env.VETTA_E2E_UPDATE_URL?.trim();
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
// 交棒前：标记 isQuitting（窗口 close 守卫只有看到它才真正销毁窗口），并跑完退出清理。
const prepareQuit = async () => {
	(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
	// 安装器会以守护进程身份把应用拉回来，那样起来的窗口不会自动到前台，
	// 打个标记让下次启动主动抢焦点（见 update-relaunch-marker.ts）。
	markPendingUpdateRelaunch(getVettaHomePath());
	console.info("[updater] running quit cleanup before handing off to the installer");
	await runQuitCleanup();
};
// 交棒后：等 Squirrel 把 ShipIt 的 launchd 作业提交上去，再硬结束本进程——
// 本进程挂着 sidecar 等句柄不会自行退出，而 launchd 要等目标退出才 spawn ShipIt。
// 三种失败模式与取舍见 mac-installer-handoff.ts。
// 所有平台都必须走到最后的 app.exit(0)：before-quit 在清理跑过后是直通的，
// 不再兜底硬退出，而本进程挂着 IM sidecar、uiohook、RPC server 等句柄，
// Electron 的正常退出流程结束不了它。Windows 的 app.relaunch() 同样只在进程
// 真正退出后才生效，不 exit 就是「指针切了、新版本起不来」。
const finalizeQuit = async () => {
	if (process.platform === "darwin") {
		const result = await handOffToInstaller({ label: MACOS_SHIPIT_JOB_LABEL });
		console.info(`[updater] installer handoff: ${result}; exiting so the installer can replace the app`);
	}
	app.exit(0);
};
const updaterEngine = new ElectronUpdaterEngine(autoUpdater, innoWindowsUpdate, nativeMacUpdateEvents, {
	prepare: prepareQuit,
	finalize: finalizeQuit,
});
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
		process.env.VETTA_E2E_UPGRADE_STATE?.trim(),
		join(getVettaHomePath(), "desktop-upgrade-e2e.json"),
		// ShipIt can relaunch without the test environment. Keep one fallback marker
		// under the runner user's normal Vetta home so the second process can find it.
		join(homedir(), ".vetta", "desktop-upgrade-e2e.json"),
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
	if (process.env.VETTA_E2E !== "1" && state.phase !== "installing") return;

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
