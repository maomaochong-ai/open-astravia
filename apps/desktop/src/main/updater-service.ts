import { basename } from "node:path";
import type { BrowserWindow } from "electron";

import type { UpdateEngine, UpdateEngineDownload, UpdateEngineInfo } from "./updater-engine.js";

const EVENT_CHANNEL = "vetta:updater:state";
const DEFAULT_AUTO_DOWNLOAD_DELAY_MS = 20_000;
const DEFAULT_AUTO_DOWNLOAD_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
const DEFAULT_DOWNLOAD_STALL_TIMEOUT_MS = 120_000;
// 传输结束后的安装准备阶段没有任何进度事件（Squirrel.Mac 要解包近 1GB 的 bundle
// 再逐个校验签名），停滞超时会误判为下载失败，这里换用一个只防死锁的长兜底。
const DEFAULT_STAGING_TIMEOUT_MS = 600_000;
// 只在启动时检查一次，长期不退出应用的用户就长期收不到更新提示，
// 因此进程内还需要一条周期性重查，外加睡眠唤醒与用户打开设置菜单时的机会性补查。
const DEFAULT_PERIODIC_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1_000;
// 机会性补查的触发源都可能连发（合盖再开、反复开合菜单），与上一次检查间隔太近就跳过。
const DEFAULT_BACKGROUND_CHECK_MIN_GAP_MS = 30 * 60 * 1_000;

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

/**
 * 宿主提供的系统电源事件。订阅发生在 app ready 之后（Electron 的 `powerMonitor`
 * 在 ready 前不可用），因此这里只暴露订阅函数，由 {@link UpdaterService.onAppReady} 调用。
 */
export interface UpdaterSystemEvents {
	/** 订阅「系统从睡眠/休眠唤醒」，返回取消订阅函数。 */
	onResume(listener: () => void): () => void;
}

export interface UpdaterServiceOptions {
	autoDownloadDelayMs?: number;
	autoDownloadRetryDelaysMs?: readonly number[];
	downloadStallTimeoutMs?: number;
	stagingTimeoutMs?: number;
	/** 周期性重查间隔；<= 0 表示关闭周期性重查。 */
	periodicCheckIntervalMs?: number;
	/** 机会性补查（唤醒、打开设置菜单）与上一次检查之间要求的最小间隔。 */
	backgroundCheckMinGapMs?: number;
	systemEvents?: UpdaterSystemEvents;
}

export class UpdaterService {
	private state: UpdaterState;
	private mainWindow: BrowserWindow | null = null;
	private latestInfo: UpdateEngineInfo | null = null;
	private activeDownload: UpdateEngineDownload | null = null;
	private autoDownloadTimer: NodeJS.Timeout | null = null;
	private downloadStallTimer: NodeJS.Timeout | null = null;
	private autoDownloadAttempts = 0;
	private autoDownloadOptOut = false;
	private lastProgressEmitAt = 0;
	private lastCheckStartedAt = 0;
	private checkPromise: Promise<UpdaterState> | null = null;
	private periodicCheckTimer: NodeJS.Timeout | null = null;
	private disposeSystemEvents: (() => void) | null = null;
	private readonly autoDownloadDelayMs: number;
	private readonly autoDownloadRetryDelaysMs: readonly number[];
	private readonly downloadStallTimeoutMs: number;
	private readonly stagingTimeoutMs: number;
	private readonly periodicCheckIntervalMs: number;
	private readonly backgroundCheckMinGapMs: number;
	private readonly systemEvents: UpdaterSystemEvents | undefined;

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
		this.downloadStallTimeoutMs = options.downloadStallTimeoutMs ?? DEFAULT_DOWNLOAD_STALL_TIMEOUT_MS;
		this.stagingTimeoutMs = options.stagingTimeoutMs ?? DEFAULT_STAGING_TIMEOUT_MS;
		this.periodicCheckIntervalMs = options.periodicCheckIntervalMs ?? DEFAULT_PERIODIC_CHECK_INTERVAL_MS;
		this.backgroundCheckMinGapMs = options.backgroundCheckMinGapMs ?? DEFAULT_BACKGROUND_CHECK_MIN_GAP_MS;
		this.systemEvents = options.systemEvents;
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
		this.disposeSystemEvents =
			this.systemEvents?.onResume(() => {
				void this.syncInBackground();
			}) ?? null;
		void this.check();
		this.schedulePeriodicCheck();
	}

	/** 停止周期性重查并退订系统事件；进程退出或测试收尾时调用。 */
	dispose(): void {
		this.clearPeriodicCheckTimer();
		this.disposeSystemEvents?.();
		this.disposeSystemEvents = null;
	}

	check(): Promise<UpdaterState> {
		if (this.checkPromise) return this.checkPromise;
		this.lastCheckStartedAt = Date.now();
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

		const download = this.engine.downloadUpdate(
			(progress) => this.onProgress(progress),
			() => this.onStaging(),
		);
		this.activeDownload = download;
		this.resetDownloadStallTimer(download);
		try {
			const paths = await download.promise;
			if (this.activeDownload !== download) return this.getState();
			const downloadedPath = paths.at(-1);
			this.clearDownloadStallTimer();
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
			this.clearDownloadStallTimer();
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
		this.clearDownloadStallTimer();
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

	/**
	 * 后台重查只在没有进行中的更新流程时发生：已经处于 available/downloading/ready/installing
	 * 时重查没有新信息，还会打断正在进行的下载状态。
	 */
	private async checkIfNotBusy(): Promise<void> {
		if (this.state.phase !== "idle" && this.state.phase !== "error") return;
		await this.check();
	}

	/**
	 * 机会性补查：系统唤醒、用户打开设置菜单等「此刻用户大概率在看应用」的时机调用。
	 * 触发源可能连发，因此与上一次检查间隔不足时直接跳过；补查后重新对齐周期，
	 * 避免刚查完又被积压的定时器再查一次。
	 */
	async syncInBackground(): Promise<void> {
		if (!this.isPackaged) return;
		if (Date.now() - this.lastCheckStartedAt < this.backgroundCheckMinGapMs) return;
		await this.checkIfNotBusy();
		this.schedulePeriodicCheck();
	}

	private schedulePeriodicCheck(): void {
		this.clearPeriodicCheckTimer();
		if (this.periodicCheckIntervalMs <= 0) return;
		const timer = setTimeout(() => {
			this.periodicCheckTimer = null;
			void this.runPeriodicCheck();
		}, this.periodicCheckIntervalMs);
		// 更新检查不应该单独把进程钉在事件循环里。
		timer.unref?.();
		this.periodicCheckTimer = timer;
	}

	private async runPeriodicCheck(): Promise<void> {
		await this.checkIfNotBusy();
		this.schedulePeriodicCheck();
	}

	private clearPeriodicCheckTimer(): void {
		if (!this.periodicCheckTimer) return;
		clearTimeout(this.periodicCheckTimer);
		this.periodicCheckTimer = null;
	}

	private onProgress(progress: { percent: number; transferred: number; total: number }): void {
		if (this.activeDownload) this.resetDownloadStallTimer(this.activeDownload);
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

	// 安装准备阶段没有进度事件，进度停在引擎给出的最后一个网络值（90%），
	// 与 Windows 的 Inno 阶段语义一致；这里只把停滞超时换成更长的兜底。
	private onStaging(): void {
		const download = this.activeDownload;
		if (!download || this.state.phase !== "downloading") return;
		this.resetDownloadStallTimer(download, this.stagingTimeoutMs);
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

	private resetDownloadStallTimer(download: UpdateEngineDownload, timeoutMs = this.downloadStallTimeoutMs): void {
		this.clearDownloadStallTimer();
		this.downloadStallTimer = setTimeout(() => {
			if (this.activeDownload !== download) return;
			this.downloadStallTimer = null;
			this.activeDownload = null;
			download.cancel();
			this.setState({
				phase: "error",
				progress: undefined,
				downloadedBytes: undefined,
				error: this.translate("updater.errors.downloadFailed"),
			});
		}, timeoutMs);
	}

	private clearDownloadStallTimer(): void {
		if (!this.downloadStallTimer) return;
		clearTimeout(this.downloadStallTimer);
		this.downloadStallTimer = null;
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
