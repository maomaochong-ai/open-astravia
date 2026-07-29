import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@vetta/coding-agent";
import { app, type BrowserWindow } from "electron";

import { DEFAULT_SERVER_URL } from "./constants.js";
import { downloadWithResume } from "./updater-download.js";
import { canPerformInPlaceUpdate, installAndRestart, preferredAssetExtension } from "./updater-install.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 服务端响应类型 ───

interface ReleaseAsset {
	id: number;
	platform: string;
	arch: string;
	file_name: string;
	file_size: number;
	content_type: string;
	/** 安装包 sha256，下载后校验；摘要机制之前发布的存量安装包为空，跳过校验 */
	sha256?: string;
}

interface LatestRelease {
	version: string;
	release_note: string;
	assets: ReleaseAsset[];
	published_at: string;
}

// ─── 旧版兼容：保留 checkForUpdate / getAppVersion 导出 ───

export interface UpdateCheckResult {
	hasUpdate: boolean;
	currentVersion: string;
	latestVersion?: string;
	releaseNote?: string;
	downloadUrl?: string;
	error?: string;
}

// ─── Updater 状态 ───

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
	/** 检查/下载/安装失败时的错误信息（中文） */
	error?: string;
	/** 用户已下载、待重启安装；true 时 sidebar 应显示"待重启"提示 */
	pendingInstall: boolean;
}

interface PendingInstallRecord {
	version: string;
	assetPath: string;
	stagingDir: string;
	platform: string;
	arch: string;
	downloadedAt: number;
}

// ─── 工具函数 ───

function getSettings(): Record<string, unknown> {
	const settingsPath = join(getAgentDir(), "settings.json");
	try {
		return JSON.parse(readFileSync(settingsPath, "utf-8"));
	} catch {
		return {};
	}
}

/** 三段式版本号比较：lv > cv 返回 true */
function compareVersions(current: string, latest: string): boolean {
	const c = current.split(".").map(Number);
	const l = latest.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const cv = c[i] || 0;
		const lv = l[i] || 0;
		if (lv > cv) return true;
		if (lv < cv) return false;
	}
	return false;
}

export function getAppVersion(): string {
	return app.isPackaged
		? app.getVersion()
		: (JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")).version as string);
}

function getPlatformId(): string {
	if (process.platform === "darwin") return "darwin";
	if (process.platform === "win32") return "win32";
	return "linux";
}

function getArchId(): string {
	return process.arch === "arm64" ? "arm64" : "x64";
}

function getServerUrl(): string {
	return DEFAULT_SERVER_URL.replace(/\/$/, "");
}

/**
 * 从 release.assets 里挑出最适合无感更新的资产：
 * 1. platform + arch 完全匹配；
 * 2. 文件扩展名匹配该平台无感更新偏好（.zip / .exe / .AppImage）；
 * 3. 若同时存在多个匹配项，选 file_size 最大的（兜底）。
 */
function pickAsset(release: LatestRelease, platform: string, arch: string): ReleaseAsset | undefined {
	const matching = release.assets.filter((a) => a.platform === platform && a.arch === arch);
	if (matching.length === 0) return undefined;
	const ext = preferredAssetExtension(process.platform);
	const preferred = matching.filter((a) => a.file_name.toLowerCase().endsWith(ext.toLowerCase()));
	const pool = preferred.length > 0 ? preferred : matching;
	return pool.reduce((best, cur) => (cur.file_size > best.file_size ? cur : best));
}

// ─── pending-install.json 持久化 ───

function getUpdatesDir(): string {
	return join(app.getPath("userData"), "updates");
}

function getPendingRecordPath(): string {
	return join(getUpdatesDir(), "pending-install.json");
}

function readPendingRecord(): PendingInstallRecord | undefined {
	const path = getPendingRecordPath();
	if (!existsSync(path)) return undefined;
	try {
		const data = JSON.parse(readFileSync(path, "utf-8")) as PendingInstallRecord;
		if (!data.assetPath || !existsSync(data.assetPath)) {
			rmSync(path, { force: true });
			return undefined;
		}
		return data;
	} catch {
		rmSync(path, { force: true });
		return undefined;
	}
}

function writePendingRecord(record: PendingInstallRecord): void {
	mkdirSync(getUpdatesDir(), { recursive: true });
	writeFileSync(getPendingRecordPath(), JSON.stringify(record, null, 2));
}

function clearPendingRecord(): void {
	rmSync(getPendingRecordPath(), { force: true });
}

// ─── 检查更新（兼容旧 API） ───

export async function checkForUpdate(): Promise<UpdateCheckResult> {
	const currentVersion = getAppVersion();
	const platform = getPlatformId();
	const arch = getArchId();
	const settings = getSettings();
	const serverToken = settings.serverToken as string | undefined;

	if (!serverToken) {
		return { hasUpdate: false, currentVersion, error: "未登录" };
	}

	try {
		const url = `${getServerUrl()}/releases/latest?platform=${platform}&arch=${arch}`;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10_000);
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${serverToken}`,
			},
		});
		clearTimeout(timeout);

		if (!response.ok) {
			if (response.status === 404) return { hasUpdate: false, currentVersion };
			return { hasUpdate: false, currentVersion, error: `HTTP ${response.status}` };
		}

		const body = (await response.json()) as { code: number; data?: LatestRelease; message?: string };
		if (body.code !== 0 || !body.data) {
			return { hasUpdate: false, currentVersion, error: body.message };
		}

		const latest = body.data;
		const hasUpdate = compareVersions(currentVersion, latest.version);
		const downloadUrl = hasUpdate
			? `${getServerUrl()}/releases/${latest.version}/download?platform=${platform}&arch=${arch}`
			: undefined;

		return {
			hasUpdate,
			currentVersion,
			latestVersion: latest.version,
			releaseNote: latest.release_note,
			downloadUrl,
		};
	} catch {
		return { hasUpdate: false, currentVersion, error: "检查更新失败" };
	}
}

// ─── UpdaterService ───

const EVENT_CHANNEL = "vetta:updater:state";

/** 发现新版后延迟多久开始静默下载：避开启动期的磁盘/网络争抢 */
const AUTO_DOWNLOAD_DELAY_MS = 20_000;
/** 静默下载失败后的重试间隔；数组长度即最大重试次数 */
const AUTO_DOWNLOAD_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];

class UpdaterService {
	private state: UpdaterState;
	private mainWindow: BrowserWindow | null = null;
	private latestRelease: LatestRelease | null = null;
	private selectedAsset: ReleaseAsset | null = null;
	private downloadAbort: AbortController | null = null;
	private lastEmitAt = 0;
	private autoDownloadTimer: NodeJS.Timeout | null = null;
	private autoDownloadAttempts = 0;
	/** 用户主动取消过：不再自动下载，避免刚取消又被后台拉起 */
	private autoDownloadOptOut = false;

	constructor() {
		this.state = {
			phase: "idle",
			currentVersion: getAppVersion(),
			pendingInstall: false,
		};
	}

	setMainWindow(win: BrowserWindow): void {
		this.mainWindow = win;
		// 窗口建好后立刻推一次当前状态，方便 renderer 启动时拿到
		this.emit(true);
	}

	getState(): UpdaterState {
		return { ...this.state };
	}

	/** 启动时调用：恢复 pending-install 状态 + 触发后台 check */
	async onAppReady(): Promise<void> {
		const pending = readPendingRecord();
		if (pending && pending.platform === getPlatformId() && pending.arch === getArchId()) {
			// 用版本号判断是否真的还有"待安装"——install 成功后新版本启动时，
			// pending-install.json 因为 detached swap.sh 异步执行可能没被及时清理，
			// 但 currentVersion 一定 ≥ pending.version。此时清理掉。
			const upgradeStillPending = compareVersions(getAppVersion(), pending.version);
			if (!upgradeStillPending) {
				rmSync(pending.stagingDir, { recursive: true, force: true });
				clearPendingRecord();
			} else {
				this.state = {
					...this.state,
					phase: "ready",
					latestVersion: pending.version,
					assetFileName: pending.assetPath.split(/[/\\]/).pop(),
					pendingInstall: true,
				};
				this.selectedAsset = {
					id: 0,
					platform: pending.platform,
					arch: pending.arch,
					file_name: pending.assetPath.split(/[/\\]/).pop() ?? "",
					file_size: 0,
					content_type: "",
				};
				this.emit(true);
			}
		}
		// 不 await：check 在后台异步执行，不阻塞启动
		void this.check();
	}

	async check(): Promise<UpdaterState> {
		// pending-install 已在场：不再覆盖状态（用户已经处于 ready）
		if (this.state.pendingInstall && this.state.phase === "ready") {
			return this.getState();
		}

		this.setState({ phase: "checking", error: undefined });
		const result = await checkForUpdate();

		if (result.error) {
			this.setState({ phase: "idle", error: result.error });
			return this.getState();
		}
		if (!result.hasUpdate || !result.latestVersion) {
			this.setState({ phase: "idle", error: undefined });
			return this.getState();
		}

		// 拉一次完整 release（拿 assets）
		const release = await this.fetchLatestRelease();
		if (!release) {
			this.setState({ phase: "idle", error: "无法获取版本资产清单" });
			return this.getState();
		}
		const asset = pickAsset(release, getPlatformId(), getArchId());
		if (!asset) {
			this.setState({
				phase: "idle",
				error: `当前平台（${getPlatformId()}-${getArchId()}）暂无对应安装包`,
			});
			return this.getState();
		}

		this.latestRelease = release;
		this.selectedAsset = asset;
		this.setState({
			phase: "available",
			latestVersion: release.version,
			releaseNote: release.release_note,
			assetFileName: asset.file_name,
			totalBytes: asset.file_size,
			error: undefined,
		});
		this.autoDownloadAttempts = 0;
		this.scheduleAutoDownload(AUTO_DOWNLOAD_DELAY_MS);
		return this.getState();
	}

	// ─── 静默后台下载 ───

	/**
	 * 安排一次后台静默下载。用户看到"有新版本"时安装包通常已经在本地，
	 * 省掉手动点击后干等整包的过程。
	 */
	private scheduleAutoDownload(delayMs: number): void {
		if (this.autoDownloadOptOut) return;
		// 装不上的平台（dev / 非 AppImage 的 Linux）不必白下一个包
		if (!canPerformInPlaceUpdate()) return;
		if (this.autoDownloadTimer) return;
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
		// 失败：残片已保留，下次续传。间隔用完就不再自动重试，
		// 用户仍可手动点 sidebar 触发（同样会续传）。
		const retryDelay = AUTO_DOWNLOAD_RETRY_DELAYS_MS[this.autoDownloadAttempts - 1];
		if (retryDelay !== undefined) this.scheduleAutoDownload(retryDelay);
	}

	private cancelScheduledAutoDownload(): void {
		if (!this.autoDownloadTimer) return;
		clearTimeout(this.autoDownloadTimer);
		this.autoDownloadTimer = null;
	}

	private async fetchLatestRelease(): Promise<LatestRelease | null> {
		const settings = getSettings();
		const serverToken = settings.serverToken as string | undefined;
		if (!serverToken) return null;
		try {
			const url = `${getServerUrl()}/releases/latest?platform=${getPlatformId()}&arch=${getArchId()}`;
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 10_000);
			const response = await fetch(url, {
				signal: controller.signal,
				headers: { Accept: "application/json", Authorization: `Bearer ${serverToken}` },
			});
			clearTimeout(timeout);
			if (!response.ok) return null;
			const body = (await response.json()) as { code: number; data?: LatestRelease };
			if (body.code !== 0 || !body.data) return null;
			return body.data;
		} catch {
			return null;
		}
	}

	/**
	 * 下载安装包。用户点击 sidebar icon 或后台静默调度都走这里。
	 * auto=true 时失败不打扰 UI（退回 available 而非 error）。
	 */
	async startDownload(options?: { auto?: boolean }): Promise<UpdaterState> {
		const auto = options?.auto === true;
		if (this.state.phase === "downloading") return this.getState();
		if (this.state.phase === "ready") return this.getState();
		if (!auto) {
			// 用户显式要下载：撤销之前的取消意愿，并取消待触发的静默下载（避免重复）
			this.autoDownloadOptOut = false;
			this.cancelScheduledAutoDownload();
		}
		if (!this.selectedAsset || !this.latestRelease) {
			// 没 check 过：自动 check 一次
			await this.check();
			if (this.state.phase !== "available") return this.getState();
		}
		if (!canPerformInPlaceUpdate()) {
			if (auto) return this.getState();
			this.setState({
				phase: "error",
				error: app.isPackaged ? "当前平台不支持无感更新，请前往发版页面手动下载" : "开发模式不支持无感更新",
			});
			return this.getState();
		}

		const release = this.latestRelease;
		const asset = this.selectedAsset;
		if (!release || !asset) return this.getState();

		const settings = getSettings();
		const serverToken = settings.serverToken as string | undefined;
		if (!serverToken) {
			if (auto) return this.getState();
			this.setState({ phase: "error", error: "未登录，无法下载更新" });
			return this.getState();
		}

		const stagingDir = join(getUpdatesDir(), release.version);
		mkdirSync(stagingDir, { recursive: true });
		const assetPath = join(stagingDir, asset.file_name);

		this.setState({
			phase: "downloading",
			progress: 0,
			downloadedBytes: 0,
			totalBytes: asset.file_size,
			error: undefined,
		});

		// 已有完整安装包（上次下载完但 pending 记录丢了）：直接复用，别重下整包
		if (!this.isAssetAlreadyComplete(assetPath, asset.file_size)) {
			this.downloadAbort = new AbortController();
			try {
				await this.downloadStream(release.version, serverToken, assetPath, asset.file_size, asset.sha256);
			} catch (err) {
				this.downloadAbort = null;
				// cancel() 触发的中断：状态已由 cancel() 置为 idle，不要覆盖
				if (err instanceof Error && err.name === "AbortError") return this.getState();
				const msg = err instanceof Error ? err.message : "下载失败";
				// 残片由 updater-download 决定去留（校验失败才删），这里不清文件，
				// 下次续传能接着下。
				if (auto) {
					this.setState({ phase: "available", progress: undefined, downloadedBytes: undefined });
					return this.getState();
				}
				this.setState({ phase: "error", error: msg });
				return this.getState();
			}
			this.downloadAbort = null;
		}

		// 落 pending-install 记录
		writePendingRecord({
			version: release.version,
			assetPath,
			stagingDir,
			platform: getPlatformId(),
			arch: getArchId(),
			downloadedAt: Date.now(),
		});

		this.setState({
			phase: "ready",
			progress: 1,
			downloadedBytes: asset.file_size,
			pendingInstall: true,
			error: undefined,
		});
		return this.getState();
	}

	/** destPath 只在校验通过后才存在，所以体积对得上就可以直接安装 */
	private isAssetAlreadyComplete(assetPath: string, expectedSize: number): boolean {
		if (!existsSync(assetPath)) return false;
		if (expectedSize <= 0) return true;
		try {
			return statSync(assetPath).size === expectedSize;
		} catch {
			return false;
		}
	}

	private async downloadStream(
		version: string,
		serverToken: string,
		destPath: string,
		expectedSize: number,
		expectedSha256?: string,
	): Promise<void> {
		await downloadWithResume({
			url: `${getServerUrl()}/releases/${version}/download?platform=${getPlatformId()}&arch=${getArchId()}`,
			headers: { Authorization: `Bearer ${serverToken}` },
			destPath,
			expectedSize,
			expectedSha256,
			signal: this.downloadAbort?.signal,
			onProgress: (received, total) => this.maybeEmitProgress(received, total),
		});
	}

	private maybeEmitProgress(received: number, total: number): void {
		const now = Date.now();
		// 节流：≤ 4 次/秒
		if (now - this.lastEmitAt < 250 && received < total) return;
		this.lastEmitAt = now;
		this.state = {
			...this.state,
			downloadedBytes: received,
			totalBytes: total,
			progress: total > 0 ? received / total : 0,
		};
		this.emit(false);
	}

	/** 用户点击「立即重启」 */
	async install(): Promise<void> {
		if (this.state.phase !== "ready") return;
		const pending = readPendingRecord();
		if (!pending) {
			this.setState({ phase: "error", error: "更新文件丢失，请重新下载" });
			return;
		}
		this.setState({ phase: "installing" });
		try {
			await installAndRestart({ assetPath: pending.assetPath, stagingDir: pending.stagingDir });
			// 走到这里说明 app.quit 已触发，下一行不会实际执行
		} catch (err) {
			const msg = err instanceof Error ? err.message : "安装失败";
			this.setState({ phase: "error", error: msg, pendingInstall: true });
		}
	}

	/** 用户点击「稍后」：保留 pending-install，UI 退到 idle 但 pendingInstall=true */
	dismissReady(): void {
		if (this.state.phase !== "ready") return;
		// 状态保持 ready + pendingInstall，下次点击 icon 时仍弹 Dialog；
		// 这里只是关闭对话框层面的视觉提示，不需要状态变更，只发一次事件即可
		this.emit(true);
	}

	/** 用户主动取消下载或丢弃已下载的更新 */
	cancel(): void {
		// 取消是明确的"我现在不想更新"，静默下载不该马上把它拉回来
		this.autoDownloadOptOut = true;
		this.cancelScheduledAutoDownload();
		if (this.downloadAbort) {
			this.downloadAbort.abort();
			this.downloadAbort = null;
		}
		const pending = readPendingRecord();
		if (pending) {
			rmSync(pending.stagingDir, { recursive: true, force: true });
			clearPendingRecord();
		}
		// 未完成的残片也一并清掉：staging 目录按版本建，整个删掉即可。
		// abort 是异步的，写流的 fd 可能还没关，Windows 上删目录会 EBUSY——
		// 删不掉不影响正确性（残片会被下次续传或重下覆盖），忽略即可。
		if (this.latestRelease) {
			try {
				rmSync(join(getUpdatesDir(), this.latestRelease.version), { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
		this.latestRelease = null;
		this.selectedAsset = null;
		this.setState({
			phase: "idle",
			progress: undefined,
			downloadedBytes: undefined,
			totalBytes: undefined,
			pendingInstall: false,
			error: undefined,
		});
	}

	private setState(patch: Partial<UpdaterState>): void {
		this.state = { ...this.state, ...patch };
		this.emit(true);
	}

	private emit(force: boolean): void {
		const win = this.mainWindow;
		if (!win || win.isDestroyed()) return;
		if (!force && Date.now() - this.lastEmitAt < 100) return;
		win.webContents.send(EVENT_CHANNEL, this.state);
	}
}

export const updaterService = new UpdaterService();
