import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_APP_INSTALLER_FILE_NAME, type UpdateInfo } from "builder-util-runtime";
import type { AppUpdater, ResolvedUpdateFileInfo } from "electron-updater";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InnoWindowsUpdateController } from "./inno-windows-update";
import { ElectronUpdaterEngine } from "./updater-engine";

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
