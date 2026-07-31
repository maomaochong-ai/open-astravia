import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_APP_INSTALLER_FILE_NAME, type ProgressInfo, type UpdateInfo } from "builder-util-runtime";
import type { AppUpdater, ResolvedUpdateFileInfo } from "electron-updater";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InnoWindowsUpdateController } from "./inno-windows-update";
import { ElectronUpdaterEngine, type NativeMacUpdateEvents } from "./updater-engine";

const temporaryRoots: string[] = [];

describe("ElectronUpdaterEngine", () => {
	afterEach(async () => {
		await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	it("installs downloaded updates silently and relaunches the app", async () => {
		const quitAndInstall = vi.fn();
		const updater = {
			on: vi.fn(),
			quitAndInstall,
		} as unknown as AppUpdater;
		const engine = new ElectronUpdaterEngine(updater);

		await engine.quitAndInstall();

		expect(quitAndInstall).toHaveBeenCalledWith(true, true);
	});

	// macOS 的窗口 close 守卫默认把关闭改成隐藏，而 Squirrel.Mac 走 NSApp terminate
	// 语义：任何一个窗口 preventDefault 都会取消整个终止流程，ShipIt 于是永远等不到
	// 进程退出，用户看到「点了立即重启但没退出，手动重启还是旧版本」。
	// prepareQuit 是异步的（要跑完退出清理），必须 await 完再交给安装器：
	// 没 await 的话 before-quit 仍会走 app.exit(0)，抢在 Squirrel.Mac 拉起
	// ShipIt 之前打死进程，表现为「退出了但版本没变」。
	it("awaits the quit preparation before handing off to Squirrel.Mac", async () => {
		const order: string[] = [];
		const updater = {
			on: vi.fn(),
			quitAndInstall: vi.fn(() => {
				order.push("quitAndInstall");
			}),
		} as unknown as AppUpdater;
		const prepareQuit = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			order.push("prepareQuit");
		});
		const engine = new ElectronUpdaterEngine(updater, undefined, undefined, { prepare: prepareQuit });

		await engine.quitAndInstall();

		expect(order).toEqual(["prepareQuit", "quitAndInstall"]);
	});

	// 交棒后必须再等安装器接手才结束进程：立刻硬 exit 会赶在 Squirrel 提交 launchd
	// 作业之前（实测 41ms），而完全不 exit 则本进程挂着 sidecar 等句柄不会自行退出，
	// launchd 又要等目标退出才 spawn ShipIt——两种都实测失败过。
	it("finalizes the quit only after the installer has been handed control", async () => {
		const order: string[] = [];
		const updater = {
			on: vi.fn(),
			quitAndInstall: vi.fn(() => {
				order.push("quitAndInstall");
			}),
		} as unknown as AppUpdater;
		const engine = new ElectronUpdaterEngine(updater, undefined, undefined, {
			prepare: () => {
				order.push("prepare");
			},
			finalize: async () => {
				order.push("finalize");
			},
		});

		await engine.quitAndInstall();

		expect(order).toEqual(["prepare", "quitAndInstall", "finalize"]);
	});

	it("marks the app as quitting before activating the Inno update", async () => {
		const order: string[] = [];
		const updateInfo: UpdateInfo = {
			version: "1.2.3",
			files: [{ url: "Vetta-1.2.3-win-x64.exe", sha512: "hash", size: 42 }],
			path: "Vetta-1.2.3-win-x64.exe",
			sha512: "installer",
			releaseDate: new Date().toISOString(),
		};
		const updater = {
			on: vi.fn(),
			off: vi.fn(),
			checkForUpdates: vi.fn().mockResolvedValue({ isUpdateAvailable: true, updateInfo }),
			updateInfoAndProvider: { provider: { resolveFiles: vi.fn().mockReturnValue([]) } },
			downloadedUpdateHelper: null,
		} as unknown as AppUpdater;
		const innoUpdate = {
			select: vi.fn().mockReturnValue({ assetFileName: "Vetta-1.2.3-win-x64.exe", totalBytes: 42 }),
			prepareDownloadedInstaller: vi.fn(),
			activate: vi.fn(() => {
				order.push("activate");
			}),
		} as unknown as InnoWindowsUpdateController;
		const prepareQuit = vi.fn(() => {
			order.push("prepareQuit");
		});
		// Windows 也必须走 finalize：activate() 只是 app.relaunch() + app.quit()，
		// 而 before-quit 在清理跑过后是直通的，没人再兜底 app.exit(0)；进程挂着
		// sidecar 等句柄不会自行退出，relaunch 也就永远不生效。
		const finalizeQuit = vi.fn(async () => {
			order.push("finalize");
		});
		const engine = new ElectronUpdaterEngine(updater, innoUpdate, undefined, {
			prepare: prepareQuit,
			finalize: finalizeQuit,
		});

		await engine.checkForUpdates();
		await engine.quitAndInstall();

		expect(order).toEqual(["prepareQuit", "activate", "finalize"]);
	});

	it("waits for Squirrel.Mac to stage the update before reporting download completion", async () => {
		let updateDownloadedListener: (() => void) | undefined;
		const nativeMacUpdateEvents: NativeMacUpdateEvents = {
			onUpdateDownloaded: (listener) => {
				updateDownloadedListener = listener;
				return () => {
					if (updateDownloadedListener === listener) updateDownloadedListener = undefined;
				};
			},
			onError: () => () => {},
		};
		const updater = {
			on: vi.fn(),
			off: vi.fn(),
			downloadUpdate: vi.fn().mockResolvedValue(["/tmp/Vetta.zip"]),
		} as unknown as AppUpdater;
		const engine = new ElectronUpdaterEngine(updater, undefined, nativeMacUpdateEvents);
		const onStaging = vi.fn();
		const onProgress = vi.fn();
		const download = engine.downloadUpdate(onProgress, onStaging);
		const progressListener = vi.mocked(updater.on).mock.calls.find(([event]) => event === "download-progress")?.[1] as
			| ((progress: ProgressInfo) => void)
			| undefined;
		progressListener?.({ bytesPerSecond: 1, delta: 1, percent: 100, total: 1, transferred: 1 });
		// 网络阶段压缩到 0～90%，剩下的 10% 留给 Squirrel.Mac 的暂存。
		expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ percent: 90 }));
		let completed = false;
		void download.promise.then(() => {
			completed = true;
		});

		await vi.waitFor(() => expect(onStaging).toHaveBeenCalledOnce());
		expect(completed).toBe(false);
		updateDownloadedListener?.();

		await expect(download.promise).resolves.toEqual(["/tmp/Vetta.zip"]);
		expect(completed).toBe(true);
	});

	it("reports native Squirrel.Mac staging failures", async () => {
		let errorListener: ((error: Error) => void) | undefined;
		const nativeMacUpdateEvents: NativeMacUpdateEvents = {
			onUpdateDownloaded: () => () => {},
			onError: (listener) => {
				errorListener = listener;
				return () => {
					if (errorListener === listener) errorListener = undefined;
				};
			},
		};
		const updater = {
			on: vi.fn(),
			off: vi.fn(),
			downloadUpdate: vi.fn().mockResolvedValue(["/tmp/Vetta.zip"]),
		} as unknown as AppUpdater;
		const engine = new ElectronUpdaterEngine(updater, undefined, nativeMacUpdateEvents);
		const download = engine.downloadUpdate(vi.fn());

		errorListener?.(new Error("native staging failed"));

		await expect(download.promise).rejects.toThrow("native staging failed");
	});

	it("passes provider-resolved asset URLs to the Inno updater", async () => {
		const updateInfo: UpdateInfo = {
			version: "1.2.3",
			files: [{ url: "Vetta-1.2.3-win-x64.exe", sha512: "hash", size: 42 }],
			path: "Vetta-1.2.3-win-x64.exe",
			sha512: "installer",
			releaseDate: new Date().toISOString(),
		};
		const resolvedFiles: Array<ResolvedUpdateFileInfo> = [
			{
				url: new URL("https://releases.example.com/Vetta-1.2.3-win-x64.exe"),
				info: updateInfo.files[0],
			},
		];
		const select = vi.fn().mockReturnValue({
			assetFileName: "Vetta-1.2.3-win-x64.exe",
			totalBytes: 42,
		});
		const prepareDownloadedInstaller = vi.fn().mockResolvedValue(["C:\\staged\\Vetta.exe"]);
		const activate = vi.fn();
		const updater = {
			on: vi.fn(),
			off: vi.fn(),
			checkForUpdates: vi.fn().mockResolvedValue({
				isUpdateAvailable: true,
				updateInfo,
			}),
			downloadUpdate: vi.fn().mockResolvedValue(["C:\\pending\\Vetta-1.2.3-win-x64.exe"]),
			updateInfoAndProvider: {
				provider: {
					resolveFiles: vi.fn().mockReturnValue(resolvedFiles),
				},
			},
			downloadedUpdateHelper: null,
		} as unknown as AppUpdater;
		const innoUpdate = {
			select,
			prepareDownloadedInstaller,
			activate,
		} as unknown as InnoWindowsUpdateController;
		const engine = new ElectronUpdaterEngine(updater, innoUpdate);

		await expect(engine.checkForUpdates()).resolves.toEqual({
			hasUpdate: true,
			info: {
				version: "1.2.3",
				releaseNote: undefined,
				assetFileName: "Vetta-1.2.3-win-x64.exe",
				totalBytes: 42,
			},
		});
		expect(select).toHaveBeenCalledWith(updateInfo, resolvedFiles);

		await expect(engine.downloadUpdate(vi.fn()).promise).resolves.toEqual(["C:\\staged\\Vetta.exe"]);
		expect(prepareDownloadedInstaller).toHaveBeenCalledWith(
			"C:\\pending\\Vetta-1.2.3-win-x64.exe",
			expect.any(Function),
			expect.any(AbortSignal),
		);
		await engine.quitAndInstall();
		expect(activate).toHaveBeenCalledOnce();
	});

	it("reports Inno preparation failures instead of launching the installer UI", async () => {
		const updateInfo: UpdateInfo = {
			version: "1.2.3",
			files: [{ url: "Vetta-1.2.3-win-x64.exe", sha512: "hash", size: 42 }],
			path: "Vetta-1.2.3-win-x64.exe",
			sha512: "installer",
			releaseDate: new Date().toISOString(),
		};
		const quitAndInstall = vi.fn();
		const updater = {
			on: vi.fn(),
			off: vi.fn(),
			quitAndInstall,
			checkForUpdates: vi.fn().mockResolvedValue({
				isUpdateAvailable: true,
				updateInfo,
			}),
			downloadUpdate: vi.fn().mockResolvedValue(["C:\\pending\\Vetta-1.2.3-win-x64.exe"]),
			updateInfoAndProvider: {
				provider: {
					resolveFiles: vi.fn().mockReturnValue([
						{
							url: new URL("https://releases.example.com/Vetta-1.2.3-win-x64.exe"),
							info: updateInfo.files[0],
						},
					]),
				},
			},
			downloadedUpdateHelper: null,
		} as unknown as AppUpdater;
		const innoUpdate = {
			select: vi.fn().mockReturnValue({
				assetFileName: "Vetta-1.2.3-win-x64.exe",
				totalBytes: 42,
			}),
			prepareDownloadedInstaller: vi.fn().mockRejectedValue(new Error("incomplete Inno version")),
			activate: vi.fn(),
		} as unknown as InnoWindowsUpdateController;
		const engine = new ElectronUpdaterEngine(updater, innoUpdate);

		await engine.checkForUpdates();
		await expect(engine.downloadUpdate(vi.fn()).promise).rejects.toThrow("incomplete Inno version");
		expect(quitAndInstall).not.toHaveBeenCalled();
	});

	it("promotes the differential cache baseline before running Inno Setup", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-updater-engine-"));
		temporaryRoots.push(root);
		const cacheDir = join(root, "cache");
		const installerPath = join(cacheDir, "pending", "Vetta-1.2.3-win-x64.exe");
		await mkdir(join(cacheDir, "pending"), { recursive: true });
		await writeFile(installerPath, "new installer");
		await writeFile(join(cacheDir, CURRENT_APP_INSTALLER_FILE_NAME), "old installer");
		const updateInfo: UpdateInfo = {
			version: "1.2.3",
			files: [{ url: "Vetta-1.2.3-win-x64.exe", sha512: "hash", size: 42 }],
			path: "Vetta-1.2.3-win-x64.exe",
			sha512: "installer",
			releaseDate: new Date().toISOString(),
		};
		const prepareDownloadedInstaller = vi.fn(async () => {
			expect(await readFile(join(cacheDir, CURRENT_APP_INSTALLER_FILE_NAME), "utf8")).toBe("new installer");
			throw new Error("Inno Setup interrupted");
		});
		const updater = {
			on: vi.fn(),
			off: vi.fn(),
			checkForUpdates: vi.fn().mockResolvedValue({
				isUpdateAvailable: true,
				updateInfo,
			}),
			downloadUpdate: vi.fn().mockResolvedValue([installerPath]),
			updateInfoAndProvider: {
				provider: {
					resolveFiles: vi.fn().mockReturnValue([
						{
							url: new URL("https://releases.example.com/Vetta-1.2.3-win-x64.exe"),
							info: updateInfo.files[0],
						},
					]),
				},
			},
			downloadedUpdateHelper: { cacheDir },
		} as unknown as AppUpdater;
		const innoUpdate = {
			select: vi.fn().mockReturnValue({
				assetFileName: "Vetta-1.2.3-win-x64.exe",
				totalBytes: 42,
			}),
			prepareDownloadedInstaller,
			activate: vi.fn(),
		} as unknown as InnoWindowsUpdateController;
		const engine = new ElectronUpdaterEngine(updater, innoUpdate);

		await engine.checkForUpdates();
		await expect(engine.downloadUpdate(vi.fn()).promise).rejects.toThrow("Inno Setup interrupted");
		expect(prepareDownloadedInstaller).toHaveBeenCalledOnce();
	});
});
