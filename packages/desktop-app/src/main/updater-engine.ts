import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { CancellationToken } from "builder-util-runtime";
import type { AppUpdater } from "electron-updater";

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
	checkForUpdates(): Promise<UpdateEngineCheckResult | null>;
	downloadUpdate(onProgress: (progress: ProgressInfo) => void): UpdateEngineDownload;
	quitAndInstall(): void;
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
	constructor(private readonly updater: AppUpdater) {
		this.updater.autoDownload = false;
		this.updater.autoInstallOnAppQuit = true;
		this.updater.allowDowngrade = false;
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

	async checkForUpdates(): Promise<UpdateEngineCheckResult | null> {
		const result = await this.updater.checkForUpdates();
		if (!result) return null;
		return {
			hasUpdate: result.isUpdateAvailable,
			info: mapUpdateInfo(result.updateInfo),
		};
	}

	downloadUpdate(onProgress: (progress: ProgressInfo) => void): UpdateEngineDownload {
		const cancellationToken = new CancellationToken();
		const listener = (progress: ProgressInfo) => onProgress(progress);
		this.updater.on("download-progress", listener);

		const promise = this.updater.downloadUpdate(cancellationToken).finally(() => {
			this.updater.off("download-progress", listener);
		});

		return {
			promise,
			cancel: () => cancellationToken.cancel(),
		};
	}

	quitAndInstall(): void {
		this.updater.quitAndInstall();
	}
}
