import { link, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { CancellationToken, CURRENT_APP_INSTALLER_FILE_NAME } from "builder-util-runtime";
import type { AppUpdater, ResolvedUpdateFileInfo } from "electron-updater";

import { stripReleaseNoteHeader } from "../shared/release-note-header.js";

import type { InnoWindowsUpdateController } from "./inno-windows-update.js";
import { launchMacUnsignedInstaller } from "./mac-unsigned-installer.js";

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
	/**
	 * `onStaging` 表示传输已结束、进入不再产生 progress 的安装准备阶段
	 * （macOS 下即 Squirrel.Mac 解包与签名校验），调用方据此改用更长的兜底超时。
	 */
	downloadUpdate(onProgress: (progress: ProgressInfo) => void, onStaging?: () => void): UpdateEngineDownload;
	quitAndInstall(): Promise<void>;
}

/**
 * 把控制权交给安装器前后各需要一次介入，缺任何一个这条链路都会静默失败，
 * 三种失败模式见 quitAndInstall 的注释与 mac-installer-handoff.ts。
 */
/**
 * 把控制权交给安装器前后各需要一次介入，缺任何一个这条链路都会静默失败，
 * 三种失败模式见 quitAndInstall 的注释与 mac-installer-handoff.ts。
 */
export interface UpdateEngineQuitHooks {
	/** 交棒前：标记应用正在退出，并跑完退出清理。 */
	prepare?: () => Promise<void> | void;
	/**
	 * 交棒后：等安装器接手。返回值决定进程还归不归引擎管：
	 * `"started"` 安装器已接手，引擎硬退出；`"exiting"` 交接方自己负责退出
	 * （Windows 必须走正常 quit 流程 relauncher 才会 spawn）；`"unavailable"`
	 * 安装器根本没接手，引擎改走内置安装器，绝不能让进程悄悄消失。
	 */
	handOff?: (mode: UpdateInstallMode) => Promise<UpdateHandoffResult>;
	/** 兜底硬退出，所有平台都挂在 app.exit 上。 */
	exit?: (code: number) => void;
}

/** 本次真正执行的安装通道，交棒方据此决定怎么退出、要不要等 ShipIt。 */
export type UpdateInstallMode = "electron-updater" | "mac-squirrel" | "mac-built-in" | "windows-inno";

export type UpdateHandoffResult = "started" | "exiting" | "unavailable";

export interface NativeMacUpdateEvents {
	onUpdateDownloaded(listener: () => void): () => void;
	onError(listener: (error: Error) => void): () => void;
}

interface UpdateProviderAccess {
	updateInfoAndProvider: {
		provider: {
			resolveFiles(info: UpdateInfo): Array<ResolvedUpdateFileInfo>;
		};
	} | null;
	downloadedUpdateHelper: {
		cacheDir: string;
		readonly cacheDirForPendingUpdate: string;
	} | null;
}

/**
 * 未签名 macOS 包的升级通道。
 *
 * Squirrel.Mac 替换前会用当前包的指定要求校验新包，adhoc 包连自己的 CodeResources
 * 都不完整，校验必然失败（`code has no resources but signature indicates they must
 * be present`）。这类包只能自己解包替换，见 mac-unsigned-installer.ts。
 */
export interface MacUnsignedInstallOptions {
	/** 正在运行的 `.app`，脚本替换的就是它。 */
	appPath: string;
	/** 安装脚本与日志的落脚点。 */
	cacheRoot: string;
	/**
	 * 探针判定为未签名：直接走内置安装器，不必先等一趟 Squirrel。
	 * 判定为 false 不代表安全——交棒失败时仍会回退到内置安装器。
	 */
	preferBuiltIn?: boolean;
	/** 仅测试：记录调用而不真的启动脚本。 */
	launch?: typeof launchMacUnsignedInstaller;
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
		await rm(currentInstallerPath, { force: true });
		await rename(temporaryPath, currentInstallerPath);
	} catch (error) {
		await Promise.all([
			rm(temporaryPath, { force: true }),
			rm(currentInstallerPath, { force: true }),
			rm(join(cacheDir, "current.blockmap"), { force: true }),
		]);
		throw error;
	}
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo["releaseNotes"]): string | undefined {
	if (typeof releaseNotes === "string") return stripReleaseNoteHeader(releaseNotes) || undefined;
	if (!Array.isArray(releaseNotes)) return undefined;

	const notes = releaseNotes
		.map((item) => item.note)
		.filter((note): note is string => typeof note === "string" && note.length > 0);
	if (notes.length === 0) return undefined;
	// 单个版本：对话框已有版本标题，去掉正文开头的「# Astravia x.y.z」。
	// 跨多个版本时各段的标题是区分版本的唯一线索，原样保留。
	if (notes.length === 1) return stripReleaseNoteHeader(notes[0] ?? "") || undefined;
	return notes.join("\n\n");
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

function waitForNativeMacUpdate(events: NativeMacUpdateEvents): { promise: Promise<void>; dispose: () => void } {
	let disposed = false;
	let removeUpdateDownloadedListener = () => {};
	let removeErrorListener = () => {};

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		removeUpdateDownloadedListener();
		removeErrorListener();
	};
	const promise = new Promise<void>((resolve, reject) => {
		removeUpdateDownloadedListener = events.onUpdateDownloaded(() => {
			dispose();
			resolve();
		});
		removeErrorListener = events.onError((error) => {
			dispose();
			reject(error);
		});
	});

	return { promise, dispose };
}

export class ElectronUpdaterEngine implements UpdateEngine {
	private useInnoUpdate = false;
	/** 未签名/已交棒失败时待安装的 ZIP；拿到它说明下载与校验都已完成。 */
	private macPendingArchive: string | undefined;
	/** 本次检查到的资产名，用于在 pending 目录里找回 ZIP。 */
	private macAssetFileName: string | undefined;

	/** 探针判定为未签名：优先走内置安装器，不等 Squirrel。 */
	private get preferBuiltInInstall(): boolean {
		return this.macInstallTarget?.preferBuiltIn === true;
	}

	constructor(
		private readonly updater: AppUpdater,
		private readonly innoWindowsUpdate?: InnoWindowsUpdateController,
		private readonly nativeMacUpdateEvents?: NativeMacUpdateEvents,
		private readonly quitHooks: UpdateEngineQuitHooks = {},
		private readonly macInstallTarget?: MacUnsignedInstallOptions,
	) {
		this.updater.autoDownload = false;
		// 已判定为未签名的包自己换包：退出时再让 Squirrel 试一次只会重现验签失败。
		this.updater.autoInstallOnAppQuit = !innoWindowsUpdate && !this.preferBuiltInInstall;
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
		await this.innoWindowsUpdate?.markCurrentVersionHealthy();
	}

	async checkForUpdates(): Promise<UpdateEngineCheckResult | null> {
		const result = await this.updater.checkForUpdates();
		if (!result) return null;
		const info = mapUpdateInfo(result.updateInfo);
		const innoAsset = result.isUpdateAvailable
			? this.innoWindowsUpdate?.select(result.updateInfo, resolveUpdateFiles(this.updater, result.updateInfo))
			: null;
		this.useInnoUpdate = innoAsset !== null && innoAsset !== undefined;
		this.macAssetFileName = info.assetFileName;
		return {
			hasUpdate: result.isUpdateAvailable,
			info: innoAsset ? { ...info, ...innoAsset } : info,
		};
	}

	downloadUpdate(onProgress: (progress: ProgressInfo) => void, onStaging?: () => void): UpdateEngineDownload {
		const cancellationToken = new CancellationToken();
		const abortController = new AbortController();
		// 两个平台的下载后都还有一段本地安装准备（Windows 的 Inno 展开版本目录、
		// macOS 的 Squirrel.Mac 解包与验签），因此网络阶段统一压缩到 0～90%，
		// 「90% 之后是本地准备而非网络问题」这条排障语义在两端一致。
		const listener = (progress: ProgressInfo) => {
			const hasLocalPreparation = this.useInnoUpdate || this.nativeMacUpdateEvents !== undefined;
			onProgress(
				hasLocalPreparation
					? {
							...progress,
							percent: Math.min(90, progress.percent * 0.9),
						}
					: progress,
			);
		};
		this.updater.on("download-progress", listener);
		// 未签名包不等 Squirrel：它的签名校验必然失败，等下去只会把下载成功判成失败。
		const nativeMacReadiness =
			this.nativeMacUpdateEvents && !this.preferBuiltInInstall
				? waitForNativeMacUpdate(this.nativeMacUpdateEvents)
				: undefined;
		if (nativeMacReadiness) {
			console.info("[updater] waiting for Squirrel.Mac to stage the update");
		}

		const updaterDownloadPromise = this.updater.downloadUpdate(cancellationToken);
		// electron-updater 在把 ZIP 喂完给 Squirrel.Mac 的那一刻就 resolve，之后的解包与
		// 签名校验不再产生 download-progress 事件，必须显式告知调用方进入了暂存阶段。
		const stagedDownloadPromise = nativeMacReadiness
			? Promise.all([
					updaterDownloadPromise.then((downloadedPaths) => {
						onStaging?.();
						return downloadedPaths;
					}),
					nativeMacReadiness.promise,
				]).then(([downloadedPaths]) => {
					console.info("[updater] Squirrel.Mac update is ready to install");
					return downloadedPaths;
				})
			: updaterDownloadPromise;
		const promise = stagedDownloadPromise
			.then(async (downloadedPaths) => {
				// 未签名包：ZIP 已经落盘并通过哈希校验，直接认领，不等 Squirrel 的验签结论。
				// 「Squirrel 拒绝」有两种到达方式——downloadUpdate reject（下面的 catch 接）
				// 和只发一个 error 事件、Promise 照常 resolve。只处理前者时，ZIP 始终没被认领，
				// quitAndInstall() 就会退回 Squirrel 那条对未签名包必然失败的路：
				// 进度停在 100%、进程退出、用户重开还是旧版本，且全程没有任何报错。
				if (this.preferBuiltInInstall) this.macPendingArchive ??= await this.findPendingArchive();
				if (!this.useInnoUpdate || !this.innoWindowsUpdate) return downloadedPaths;
				const installerPath = downloadedPaths[0];
				if (!installerPath) throw new Error("electron-updater did not return a Windows installer");
				await promoteDownloadedInstaller(this.updater, installerPath)
					.then(() => console.info("[updater] differential cache baseline promoted"))
					.catch((error) => console.warn("[updater] unable to promote differential cache baseline", error));
				console.info("[updater] preparing downloaded Windows version with Inno Setup", installerPath);
				const preparedPaths = await this.innoWindowsUpdate.prepareDownloadedInstaller(
					installerPath,
					onProgress,
					abortController.signal,
				);
				console.info("[updater] downloaded Windows version is ready", preparedPaths[0]);
				return preparedPaths;
			})
			.catch(async (error: unknown) => {
				// 未签名包：ZIP 已经下载并通过哈希校验，是 Squirrel 之后的验签失败。
				// 这种情况下把缓存里的 ZIP 当成「已就绪」，由 quitAndInstall 自己解包替换。
				if (!this.preferBuiltInInstall) throw error;
				const archive = await this.findPendingArchive();
				if (!archive) throw error;
				this.macPendingArchive = archive;
				console.warn(
					"[updater] Squirrel.Mac refused the update, falling back to the built-in installer:",
					error instanceof Error ? error.message : error,
				);
				return [archive];
			})
			.finally(() => {
				nativeMacReadiness?.dispose();
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

	/**
	 * 在 electron-updater 的缓存里找回已下载的 ZIP。名字取自更新清单里的资产名，
	 * 也是 `executeDownload` 落盘用的名字。
	 *
	 * 顺序上先认精确名字，再退到「最新的 ZIP」，最后才看缓存根：清单里的
	 * `files[0]` 可能是另一个架构，而差量下载会把 `update.zip` 放在 pending 之外。
	 * 找不到就等于没有可替换的包，调用方必须报错而不是退回 Squirrel。
	 */
	private async findPendingArchive(): Promise<string | undefined> {
		const helper = (this.updater as unknown as UpdateProviderAccess).downloadedUpdateHelper;
		if (!helper) return undefined;
		const pendingDir = helper.cacheDirForPendingUpdate;
		const exact = this.macAssetFileName ? join(pendingDir, this.macAssetFileName) : undefined;
		if (exact) {
			try {
				await stat(exact);
				return exact;
			} catch {
				// 清单里可能同时有 x64 与 arm64 两个 ZIP，files[0] 未必是本机下载的那个。
			}
		}
		const directories = [pendingDir, helper.cacheDir];
		for (const directory of directories) {
			const newest = await this.newestArchiveIn(directory);
			if (newest) return newest;
		}
		return undefined;
	}

	/** 目录里最新的 `.zip`：只可能是刚才这次下载的产物。 */
	private async newestArchiveIn(directory: string): Promise<string | undefined> {
		try {
			const entries = await readdir(directory, { withFileTypes: true });
			const candidates = await Promise.all(
				entries
					.filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
					.map(async (entry) => {
						const path = join(directory, entry.name);
						const info = await stat(path);
						return { path, mtimeMs: info.mtimeMs };
					}),
			);
			candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
			return candidates[0]?.path;
		} catch {
			return undefined;
		}
	}

	async quitAndInstall(): Promise<void> {
		// 未签名包只有内置安装器这一条路。绝不能退回 Squirrel：它对未签名包的替换前
		// 验签必然失败，而失败发生后没有人再改道，用户看到的就是「进度到 100%、
		// 应用退出、重开还是旧版本」。宁可在这里就报错。
		// 走到这里时 ZIP 理论上已经认领（下载阶段 + 下载失败的 catch），再兜一次是
		// 为了兼容先 quitAndInstall 后下载的旧调用顺序。
		// 这个检查必须排在 prepare 之前：prepare 会标记 isQuitting、写重启标记并跑完
		// 退出清理，报错如果落在它后面，应用就停在「清理已做、窗口已关、却还活着」的状态。
		const macInstaller = this.macInstallTarget;
		const preferBuiltIn = this.preferBuiltInInstall;
		let macArchive: string | undefined;
		if (macInstaller && preferBuiltIn) {
			this.macPendingArchive ??= await this.findPendingArchive();
			macArchive = this.macPendingArchive;
			if (!macArchive) throw new Error("unsigned macOS update has no staged archive to install");
		}
		// 交棒前：标记「正在退出」并跑完退出清理。不标记的话窗口 close 守卫会把关闭
		// 改成隐藏，而 Squirrel.Mac 走 NSApp terminate 语义，任一窗口 preventDefault
		// 就取消整个终止流程——症状是「点了重启但应用没退」。
		await this.quitHooks.prepare?.();

		let mode: UpdateInstallMode = process.platform === "darwin" ? "mac-squirrel" : "electron-updater";
		if (macInstaller && preferBuiltIn && macArchive) {
			// 未签名包：Squirrel 装不了，改由脱离进程的脚本等本进程退出后换包。
			await this.launchBuiltInInstaller(macInstaller, macArchive);
			mode = "mac-built-in";
		} else if (this.useInnoUpdate && this.innoWindowsUpdate) {
			await this.innoWindowsUpdate.activate();
			mode = "windows-inno";
		} else {
			this.updater.quitAndInstall(true, true);
		}

		// 交棒后：等安装器接手再结束进程。既不能立刻硬 exit（Squirrel 还没提交
		// launchd 作业），也不能不 exit（本进程挂着 sidecar 等句柄不会自行退出，而
		// launchd 要等目标进程退出才 spawn ShipIt）。两种都实测失败过，
		// 详见 mac-installer-handoff.ts。
		const verdict = (await this.quitHooks.handOff?.(mode)) ?? "started";
		if (verdict === "exiting") return;
		if (verdict === "unavailable") {
			// ShipIt 作业没提交上去（实测会走到 job-missing）：此时安装器根本没接手，
			// 硬退出只会让用户「重开还是旧版本」且全程无报错。手里有已校验的 ZIP 就
			// 自己换包，没有就抛出去让 UI 报错——绝不静默退出。
			if (!macInstaller) {
				throw new Error("macOS installer did not take over and no built-in installer is available");
			}
			// 探针可能漏判（实测就漏过）：这里不信任它，直接找已校验的 ZIP 自己换包。
			const fallbackArchive = macArchive ?? (await this.findPendingArchive());
			if (!fallbackArchive) {
				throw new Error("macOS installer did not take over and no staged archive is available");
			}
			console.warn("[updater] Squirrel.Mac handoff failed, falling back to the built-in installer");
			await this.launchBuiltInInstaller(macInstaller, fallbackArchive);
			await this.quitHooks.handOff?.("mac-built-in");
		}
		this.quitHooks.exit?.(0);
	}

	private async launchBuiltInInstaller(installer: MacUnsignedInstallOptions, archivePath: string): Promise<void> {
		const launch = installer.launch ?? launchMacUnsignedInstaller;
		const scriptPath = await launch({
			appPath: installer.appPath,
			archivePath,
			cacheRoot: installer.cacheRoot,
			scriptName: this.macAssetFileName?.replace(/\.zip$/u, "") ?? "update",
		});
		console.info("[updater] built-in installer script is running:", scriptPath);
	}
}
