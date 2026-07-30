import { basename } from "node:path";
import type { BrowserWindow } from "electron";

import type { UpdateEngine, UpdateEngineDownload, UpdateEngineInfo } from "./updater-engine.js";

const EVENT_CHANNEL = "vetta:updater:state";
const DEFAULT_AUTO_DOWNLOAD_DELAY_MS = 20_000;
const DEFAULT_AUTO_DOWNLOAD_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];

export type UpdaterPhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdaterState {
	phase: UpdaterPhase;
	currentVersion: string;
	latestVersion?: string;
	releaseNote?: string;
	/** 0..1 */
	progress?: number;
	downloadedBytes?: number;
	totalBytes?: number;
	assetFileName?: string;
	error?: string;
}

export type UpdaterTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface UpdaterServiceOptions {
	autoDownloadDelayMs?: number;
	autoDownloadRetryDelaysMs?: readonly number[];
}

export class UpdaterService {
	private state: UpdaterState;
	private mainWindow: BrowserWindow | null = null;
	private latestInfo: UpdateEngineInfo | null = null;
	private activeDownload: UpdateEngineDownload | null = null;
	private autoDownloadTimer: NodeJS.Timeout | null = null;
	private autoDownloadAttempts = 0;
	private autoDownloadOptOut = false;
	private lastProgressEmitAt = 0;
	private checkPromise: Promise<UpdaterState> | null = null;
	private readonly autoDownloadDelayMs: number;
	private readonly autoDownloadRetryDelaysMs: readonly number[];

	constructor(
		private readonly engine: UpdateEngine,
		currentVersion: string,
		private readonly isPackaged: boolean,
		private readonly translate: UpdaterTranslate,
		options: UpdaterServiceOptions = {},
	) {
		this.state = {
			phase: "idle",
			currentVersion,
		};
		this.autoDownloadDelayMs = options.autoDownloadDelayMs ?? DEFAULT_AUTO_DOWNLOAD_DELAY_MS;
		this.autoDownloadRetryDelaysMs = options.autoDownloadRetryDelaysMs ?? DEFAULT_AUTO_DOWNLOAD_RETRY_DELAYS_MS;
	}

	setMainWindow(win: BrowserWindow): void {
		this.mainWindow = win;
		this.emit();
	}

	getState(): UpdaterState {
		return { ...this.state };
	}

	async onAppReady(): Promise<void> {
		if (!this.isPackaged) return;
		await this.engine.onAppReady?.();
		void this.check();
	}

	check(): Promise<UpdaterState> {
		if (this.checkPromise) return this.checkPromise;
		this.checkPromise = this.runCheck().finally(() => {
			this.checkPromise = null;
		});
		return this.checkPromise;
	}

	private async runCheck(): Promise<UpdaterState> {
		if (!this.isPackaged) {
			this.setState({
				phase: "error",
				error: this.translate("updater.errors.developmentUnsupported"),
			});
			return this.getState();
		}

		this.setState({ phase: "checking", error: undefined });
		try {
			const result = await this.engine.checkForUpdates();
			if (!result) {
				this.setState({
					phase: "idle",
					error: this.translate("updater.errors.configurationUnavailable"),
				});
				return this.getState();
			}

			if (!result.hasUpdate) {
				this.latestInfo = null;
				this.setState({
					phase: "idle",
					latestVersion: result.info.version,
					releaseNote: result.info.releaseNote,
					progress: undefined,
					downloadedBytes: undefined,
					totalBytes: undefined,
					assetFileName: undefined,
					error: undefined,
				});
				return this.getState();
			}

			this.latestInfo = result.info;
			this.autoDownloadAttempts = 0;
			this.setState({
				phase: "available",
				latestVersion: result.info.version,
				releaseNote: result.info.releaseNote,
				assetFileName: result.info.assetFileName,
				totalBytes: result.info.totalBytes,
				progress: undefined,
				downloadedBytes: undefined,
				error: undefined,
			});
			this.scheduleAutoDownload(this.autoDownloadDelayMs);
		} catch (error) {
			console.error("[updater] check failed", error);
			this.setState({
				phase: "idle",
				error: this.translate("updater.errors.checkFailed"),
			});
		}
		return this.getState();
	}

	async startDownload(options?: { auto?: boolean }): Promise<UpdaterState> {
		const auto = options?.auto === true;
		if (this.state.phase === "downloading" || this.state.phase === "ready") return this.getState();
		if (!this.isPackaged) {
			if (!auto) {
				this.setState({
					phase: "error",
					error: this.translate("updater.errors.developmentUnsupported"),
				});
			}
			return this.getState();
		}

		if (!auto) {
			this.autoDownloadOptOut = false;
			this.cancelScheduledAutoDownload();
		}
		if (!this.latestInfo) {
			await this.check();
			if (this.state.phase !== "available" || !this.latestInfo) return this.getState();
		}

		this.setState({
			phase: "downloading",
			progress: 0,
			downloadedBytes: 0,
			totalBytes: this.latestInfo.totalBytes,
			error: undefined,
		});

		const download = this.engine.downloadUpdate((progress) => this.onProgress(progress));
		this.activeDownload = download;
		try {
			const paths = await download.promise;
			if (this.activeDownload !== download) return this.getState();
			const downloadedPath = paths.at(-1);
			this.activeDownload = null;
			this.setState({
				phase: "ready",
				progress: 1,
				downloadedBytes: this.state.totalBytes,
				assetFileName: downloadedPath ? basename(downloadedPath) : this.state.assetFileName,
				error: undefined,
			});
		} catch (error) {
			if (this.activeDownload !== download) return this.getState();
			this.activeDownload = null;
			console.error("[updater] download failed", error);
			if (auto) {
				this.setState({
					phase: "available",
					progress: undefined,
					downloadedBytes: undefined,
					error: undefined,
				});
			} else {
				this.setState({
					phase: "error",
					error: this.translate("updater.errors.downloadFailed"),
				});
			}
		}
		return this.getState();
	}

	async install(): Promise<void> {
		if (this.state.phase !== "ready") return Promise.resolve();
		this.setState({ phase: "installing" });
		try {
			await this.engine.quitAndInstall();
		} catch (error) {
			console.error("[updater] install failed", error);
			this.setState({
				phase: "error",
				error: this.translate("updater.errors.installFailed"),
			});
		}
	}

	dismissReady(): void {
		if (this.state.phase === "ready") this.emit();
	}

	cancel(): void {
		if (this.state.phase === "ready" || this.state.phase === "installing") return;
		this.autoDownloadOptOut = true;
		this.cancelScheduledAutoDownload();
		const download = this.activeDownload;
		this.activeDownload = null;
		download?.cancel();
		this.latestInfo = null;
		this.setState({
			phase: "idle",
			latestVersion: undefined,
			releaseNote: undefined,
			progress: undefined,
			downloadedBytes: undefined,
			totalBytes: undefined,
			assetFileName: undefined,
			error: undefined,
		});
	}

	private onProgress(progress: { percent: number; transferred: number; total: number }): void {
		const now = Date.now();
		if (now - this.lastProgressEmitAt < 250 && progress.transferred < progress.total) return;
		this.lastProgressEmitAt = now;
		this.state = {
			...this.state,
			progress: Math.max(0, Math.min(1, progress.percent / 100)),
			downloadedBytes: progress.transferred,
			totalBytes: progress.total,
		};
		this.emit();
	}

	private scheduleAutoDownload(delayMs: number): void {
		if (this.autoDownloadOptOut || this.autoDownloadTimer) return;
		this.autoDownloadTimer = setTimeout(() => {
			this.autoDownloadTimer = null;
			void this.runAutoDownload();
		}, delayMs);
	}

	private async runAutoDownload(): Promise<void> {
		if (this.state.phase !== "available") return;
		this.autoDownloadAttempts += 1;
		const result = await this.startDownload({ auto: true });
		if (result.phase === "ready" || this.autoDownloadOptOut) return;
		const retryDelay = this.autoDownloadRetryDelaysMs[this.autoDownloadAttempts - 1];
		if (retryDelay !== undefined) this.scheduleAutoDownload(retryDelay);
	}

	private cancelScheduledAutoDownload(): void {
		if (!this.autoDownloadTimer) return;
		clearTimeout(this.autoDownloadTimer);
		this.autoDownloadTimer = null;
	}

	private setState(patch: Partial<UpdaterState>): void {
		this.state = { ...this.state, ...patch };
		this.emit();
	}

	private emit(): void {
		const win = this.mainWindow;
		if (!win || win.isDestroyed()) return;
		win.webContents.send(EVENT_CHANNEL, this.state);
	}
}
