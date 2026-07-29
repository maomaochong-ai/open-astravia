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

export interface DesktopUpdaterApi {
	check(): Promise<UpdaterState>;
	getState(): Promise<UpdaterState>;
	getCurrentVersion(): Promise<string>;
	/** 启动后台下载（无感）。返回最终状态。 */
	download(): Promise<UpdaterState>;
	/** 立即重启并安装（仅当 state.phase === "ready"） */
	install(): Promise<void>;
	/** 用户点"稍后"：关闭提示；应用退出时由 electron-updater 自动安装 */
	dismiss(): Promise<void>;
	/** 取消待下载或正在进行的下载；已下载完成时不执行操作 */
	cancel(): Promise<void>;
	/** 订阅状态变化。返回取消函数。 */
	onStateChanged(handler: (state: UpdaterState) => void): () => void;
}
