import type { UpdateInfo } from "builder-util-runtime";
import type { AppUpdater, ResolvedUpdateFileInfo } from "electron-updater";
import { describe, expect, it, vi } from "vitest";
import type { StagedWindowsUpdateController } from "./staged-windows-update";
import { ElectronUpdaterEngine } from "./updater-engine";

describe("ElectronUpdaterEngine", () => {
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

	it("passes provider-resolved asset URLs to the staged updater", async () => {
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
		const stageDownloadedInstaller = vi.fn().mockResolvedValue(["C:\\staged\\Vetta.exe"]);
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
		const stagedUpdate = {
			select,
			stageDownloadedInstaller,
			activate,
		} as unknown as StagedWindowsUpdateController;
		const engine = new ElectronUpdaterEngine(updater, stagedUpdate);

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
		expect(stageDownloadedInstaller).toHaveBeenCalledWith(
			"C:\\pending\\Vetta-1.2.3-win-x64.exe",
			expect.any(Function),
			expect.any(AbortSignal),
		);
		await engine.quitAndInstall();
		expect(activate).toHaveBeenCalledOnce();
	});
});
