import { copyFile, link, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { CancellationError, CancellationToken, CURRENT_APP_INSTALLER_FILE_NAME } from "builder-util-runtime";
import type { AppUpdater, ResolvedUpdateFileInfo } from "electron-updater";

import type { StagedWindowsUpdateController } from "./staged-windows-update.js";

export interface UpdateEngineInfo {
	version: string;
	releaseNote?: string;
	assetFileName?: string;
	totalBytes?: number;
}

export interface UpdateEngineCheckResult {
	hasUpdate: boolean;
	info: UpdateEngineInfo;
}

export interface UpdateEngineDownload {
	promise: Promise<string[]>;
	cancel(): void;
}

export interface UpdateEngine {
	onAppReady?(): Promise<void>;
	checkForUpdates(): Promise<UpdateEngineCheckResult | null>;
	downloadUpdate(onProgress: (progress: ProgressInfo) => void): UpdateEngineDownload;
	quitAndInstall(): Promise<void>;
}

interface UpdateProviderAccess {
	updateInfoAndProvider: {
		provider: {
			resolveFiles(info: UpdateInfo): Array<ResolvedUpdateFileInfo>;
		};
	} | null;
	downloadedUpdateHelper: {
		cacheDir: string;
	} | null;
}

function resolveUpdateFiles(updater: AppUpdater, info: UpdateInfo): Array<ResolvedUpdateFileInfo> {
	const provider = (updater as unknown as UpdateProviderAccess).updateInfoAndProvider?.provider;
	return provider?.resolveFiles(info) ?? [];
}

async function promoteDownloadedInstaller(updater: AppUpdater, installerPath: string): Promise<void> {
	const cacheDir = (updater as unknown as UpdateProviderAccess).downloadedUpdateHelper?.cacheDir;
	if (!cacheDir) return;
	const currentInstallerPath = join(cacheDir, CURRENT_APP_INSTALLER_FILE_NAME);
	const temporaryPath = `${currentInstallerPath}.${process.pid}.tmp`;
	await rm(temporaryPath, { force: true });
	try {
		await link(installerPath, temporaryPath);
	} catch {
		await copyFile(installerPath, temporaryPath);
	}
	await rm(currentInstallerPath, { force: true });
	await rename(temporaryPath, currentInstallerPath);
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo["releaseNotes"]): string | undefined {
	if (typeof releaseNotes === "string") return releaseNotes || undefined;
	if (!Array.isArray(releaseNotes)) return undefined;

	const notes = releaseNotes
		.map((item) => item.note)
		.filter((note): note is string => typeof note === "string" && note.length > 0);
	return notes.length > 0 ? notes.join("\n\n") : undefined;
}

function getAssetFileName(url: string): string | undefined {
	try {
		const pathname = new URL(url).pathname;
		const fileName = pathname.split("/").pop();
		return fileName ? decodeURIComponent(fileName) : undefined;
	} catch {
		const fileName = url.split(/[\\/]/).pop();
		return fileName || undefined;
	}
}

function mapUpdateInfo(info: UpdateInfo): UpdateEngineInfo {
	const file = info.files[0];
	return {
		version: info.version,
		releaseNote: normalizeReleaseNotes(info.releaseNotes),
		assetFileName: file ? getAssetFileName(file.url) : undefined,
		totalBytes: file?.size,
	};
}

export class ElectronUpdaterEngine implements UpdateEngine {
	private useStagedUpdate = false;

	constructor(
		private readonly updater: AppUpdater,
		private readonly stagedWindowsUpdate?: StagedWindowsUpdateController,
	) {
		this.updater.autoDownload = false;
		this.updater.autoInstallOnAppQuit = !stagedWindowsUpdate;
		this.updater.allowDowngrade = false;
		this.updater.disableWebInstaller = true;
		this.updater.logger = {
			info: (message?: unknown) => console.info("[updater]", message),
			warn: (message?: unknown) => console.warn("[updater]", message),
			error: (message?: unknown) => console.error("[updater]", message),
			debug: (message: string) => console.debug("[updater]", message),
		};
		// electron-updater 会同时通过 Promise 和 error 事件报告失败。
		// 保留监听器，避免 EventEmitter 将未监听的 error 当作进程级异常。
		this.updater.on("error", (error) => {
			console.error("[updater]", error);
		});
	}

	async onAppReady(): Promise<void> {
		await this.stagedWindowsUpdate?.markCurrentVersionHealthy();
	}

	async checkForUpdates(): Promise<UpdateEngineCheckResult | null> {
		const result = await this.updater.checkForUpdates();
		if (!result) return null;
		const info = mapUpdateInfo(result.updateInfo);
		const stagedAsset = result.isUpdateAvailable
			? this.stagedWindowsUpdate?.select(result.updateInfo, resolveUpdateFiles(this.updater, result.updateInfo))
			: null;
		this.useStagedUpdate = stagedAsset !== null && stagedAsset !== undefined;
		return {
			hasUpdate: result.isUpdateAvailable,
			info: stagedAsset ? { ...info, ...stagedAsset } : info,
		};
	}

	downloadUpdate(onProgress: (progress: ProgressInfo) => void): UpdateEngineDownload {
		const cancellationToken = new CancellationToken();
		const abortController = new AbortController();
		const listener = (progress: ProgressInfo) => {
			onProgress(
				this.useStagedUpdate
					? {
							...progress,
							percent: Math.min(90, progress.percent * 0.9),
						}
					: progress,
			);
		};
		this.updater.on("download-progress", listener);

		const promise = this.updater
			.downloadUpdate(cancellationToken)
			.then(async (downloadedPaths) => {
				if (!this.useStagedUpdate || !this.stagedWindowsUpdate) return downloadedPaths;
				const installerPath = downloadedPaths[0];
				if (!installerPath) throw new Error("electron-updater did not return a Windows installer");
				try {
					const stagedPaths = await this.stagedWindowsUpdate.stageDownloadedInstaller(
						installerPath,
						onProgress,
						abortController.signal,
					);
					await promoteDownloadedInstaller(this.updater, installerPath);
					return stagedPaths;
				} catch (error) {
					if (error instanceof CancellationError || abortController.signal.aborted) throw error;
					console.error("[updater] staged EXE extraction failed; falling back to NSIS install", error);
					this.useStagedUpdate = false;
					return downloadedPaths;
				}
			})
			.finally(() => {
				this.updater.off("download-progress", listener);
			});

		return {
			promise,
			cancel: () => {
				abortController.abort();
				cancellationToken.cancel();
			},
		};
	}

	async quitAndInstall(): Promise<void> {
		if (this.useStagedUpdate && this.stagedWindowsUpdate) {
			await this.stagedWindowsUpdate.activate();
			return;
		}
		this.updater.quitAndInstall(true, true);
	}
}
