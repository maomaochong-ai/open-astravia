import "./telemetry/bootstrap.js";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { getVettaHomePath, VETTA_HOME_ENV } from "@vetta/action-rpc";
import { app, type BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, protocol, session, shell } from "electron";
import { ActionApprovalBroker } from "./app-actions/approval-broker.js";
import { createAppActionSystem } from "./app-actions/index.js";
import { createActionRpcRuntime } from "./app-actions/rpc.js";
import { APP_ASSET_PROTOCOL_PRIVILEGE, registerAppAssetProtocol } from "./app-asset-protocol.js";
import { createAppDebugRuntime } from "./app-debug/index.js";
import { createDebugRpcRuntime } from "./app-debug/rpc.js";
import { configureRendererCdp } from "./app-debug/ui/renderer-cdp.js";
import { registerAppLifecycleIpc } from "./app-lifecycle.js";
import { initializeAppMonitor, shutdownAppMonitor } from "./app-monitor/app-monitor-service.js";
import { consumeOAuthCallback, reopenOAuthLogin, startOAuthLogin } from "./auth/oauth-login.js";
import { initializeDesktopBatchTaskService } from "./batch-tasks/batch-task-service.js";
import { parseActionCliCommand, runActionCliCommand } from "./cli/action-command.js";
import { parseAgentRpcCommand, runAgentRpcCommand } from "./cli/agent-rpc-command.js";
import { parseHelpCliCommand, runHelpCliCommand } from "./cli/help-command.js";
import { parseOcrCliCommand, runOcrCliCommand } from "./cli/ocr-command.js";
import { parsePdfCliCommand, runPdfCliCommand } from "./cli/pdf-command.js";

import { ensureDevCliShim, ensureDevVettaCliShim, ensureVettaCommandShim } from "./dev-cli-shim.js";
import {
	getDiagnosticsLogPath,
	installChromiumFetchForMain,
	installMainDiagnostics,
	registerLocalNetworkAccess,
} from "./diagnostics.js";
import { FILE_PROTOCOL_PRIVILEGE, registerFileProtocolHandler } from "./file-protocol.js";
import { fixPath } from "./fix-path.js";
import { initAppLanguage } from "./i18n/index.js";
import { getImHost } from "./im-host/index.js";
import { syncAppshotGesture } from "./ipc/appshot.js";
import { persistVettaCliPaths } from "./ipc/fs.js";
import { registerI18nIpc } from "./ipc/i18n.js";
import {
	type IpcTeardown,
	registerAllIpc,
	registerBatchTasksIpc,
	registerSchedulerIpc,
	teardownAllIpc,
} from "./ipc/index.js";
import { syncQuickPanelTrigger } from "./ipc/quickpanel.js";
import { registerKnowledgeIpc } from "./knowledge/ipc.js";
import { reloadKnowledgePoller } from "./knowledge/poller.js";
import { getLocalRpcServerEndpointFilePath } from "./local-rpc/endpoint-file.js";
import { type DesktopLocalRpcServerHandle, startDesktopLocalRpcServer } from "./local-rpc/server.js";
import { getAppLogger } from "./logger.js";
import { MEDIA_PROTOCOL_PRIVILEGE, registerMediaProtocolHandler } from "./media-protocol.js";
import { openExternalUrl } from "./open-external.js";
import { startPetIdleGuard } from "./pet/pet-idle-guard.js";
import { initializePetWindow } from "./pet-window.js";
import { PluginActionService } from "./plugins/plugin-action-service.js";
import { stopAllPluginDevWatches } from "./plugins/plugin-dev-watch.js";
import { PLUGIN_PROTOCOL_PRIVILEGES, registerPluginProtocols } from "./plugins/plugin-protocol.js";
import { discoverSystemPlugins } from "./plugins/plugin-store.js";
import { stopAllUiohookConsumers } from "./quickpanel-trigger.js";
import { createQuickPanelWindow } from "./quickpanel-window.js";
import { disposeSharedRuntime, getSharedRuntime } from "./runtime.js";
import { getRuntimeManager } from "./runtimes/manager.js";
import { initializeSandboxCapability } from "./sandbox/capability.js";
import { initScheduler, scheduleTaskInCron, unscheduleTaskInCron } from "./scheduler/scheduler.js";
import { initializeDesktopSchedulerService } from "./scheduler/scheduler-service.js";
import { initializeMainTelemetry, shutdownMainTelemetry } from "./telemetry/index.js";
import { registerThemeProtocol, THEME_PROTOCOL_PRIVILEGE } from "./themes/theme-protocol.js";
import {
	createTray,
	getHideToTrayOnClose,
	getTray,
	rebuildTrayContextMenu,
	setHideToTrayOnClose,
} from "./tray-manager.js";
import { getAppVersion, updaterService } from "./updater.js";
import { createWindow, getMainWindow, loadMainWindow, setMainWindow, showMainWindow } from "./window-manager.js";

// 启动早期修复 GUI 进程的 PATH(补回 homebrew 等登录 shell 路径),必须先于
// RuntimeManager.applyEnv() 与 coding-agent 的 bash 执行。详见 fix-path.ts。
fixPath();

const PROTOCOL = "vetta";
// registerSchemesAsPrivileged 整个进程只能调用一次且须在 ready 前：
// 所有自定义 scheme（插件、主题、应用资源、媒体流）的特权声明在此合并注册。
protocol.registerSchemesAsPrivileged([
	...PLUGIN_PROTOCOL_PRIVILEGES,
	THEME_PROTOCOL_PRIVILEGE,
	MEDIA_PROTOCOL_PRIVILEGE,
	FILE_PROTOCOL_PRIVILEGE,
	APP_ASSET_PROTOCOL_PRIVILEGE,
]);
const isMac = process.platform === "darwin";
const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
const buildDir = join(appRoot, "build");
const devMainEntryPath = join(appRoot, "dist/main/index.js");
const packagedCliBinaryName = process.platform === "win32" ? "vetta.exe" : "vetta";
const packagedCliPlatformTag = `${process.platform}-${process.arch}`;
const packagedCliAppPath = join(process.resourcesPath, "cli-app", "bin", packagedCliPlatformTag, packagedCliBinaryName);
// Command-specific parsers run before the top-level help parser so commands
// like `action -h` and `ocr -h` can render their own help text.
const ocrCliCommand = parseOcrCliCommand(process.argv);
const actionCliCommand = ocrCliCommand === null ? parseActionCliCommand(process.argv) : null;
const pdfCliCommand = ocrCliCommand === null && actionCliCommand === null ? parsePdfCliCommand(process.argv) : null;
const helpCliCommand =
	ocrCliCommand === null && actionCliCommand === null && pdfCliCommand === null
		? parseHelpCliCommand(process.argv)
		: null;
// `--agent-rpc` is the IM sidecar's discriminator: when present we
// short-circuit into @vetta/coding-agent's main and skip every UI/IPC
// bring-up below. See cli/agent-rpc-command.ts for the full rationale.
const agentRpcArgs =
	pdfCliCommand === null && ocrCliCommand === null && actionCliCommand === null && helpCliCommand === null
		? parseAgentRpcCommand(process.argv)
		: null;
const isCliMode =
	pdfCliCommand !== null ||
	ocrCliCommand !== null ||
	actionCliCommand !== null ||
	helpCliCommand !== null ||
	agentRpcArgs !== null;

initializeMainTelemetry({ enabled: !isCliMode });

// 给 V8 老生代一个明确上限：超过会抛 `RangeError: Invalid string length` /
// JS heap out of memory，能被 uncaughtException 接到并落盘栈；否则任 RSS 自然
// 膨胀，最终被 Linux OOM Killer SIGKILL，进程静默消失、连一行日志都来不及写。
// 4096MB 是当前桌面端图片/PDF/批量任务工作集的经验上限，未来如果常驻数据更大
// 再上调；CLI 模式跑短任务，沿用默认值即可。
if (!isCliMode) {
	app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096");
}

// agent-rpc mode talks to its parent over stdout via the coding-agent
// RPC protocol (NDJSON). Two console-related hazards we have to defuse:
//
//   1) installMainDiagnostics() monkey-patches console.log into a file
//      logger. coding-agent's RPC output goes through `console.log` so
//      the patch would swallow every response and the sidecar hangs on
//      handshake. Skip it.
//   2) Other main-process modules (installChromiumFetchForMain,
//      registerLocalNetworkAccess, sandbox probes…) call `console.log`
//      for status. With (1) skipped, those land on raw stdout and
//      interleave with RPC NDJSON, corrupting the protocol. Redirect
//      every console method to stderr in agent-rpc mode so the only
//      thing on stdout is coding-agent's own JSON.
if (agentRpcArgs) {
	const writeStderr = (level: string, args: unknown[]) => {
		const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 0))).join(" ");
		process.stderr.write(`[${level}] ${line}\n`);
	};
	console.log = (...args: unknown[]) => writeStderr("log", args);
	console.info = (...args: unknown[]) => writeStderr("info", args);
	console.warn = (...args: unknown[]) => writeStderr("warn", args);
	console.error = (...args: unknown[]) => writeStderr("error", args);
	console.debug = (...args: unknown[]) => writeStderr("debug", args);
	// Quietly swallow stdin errors so a parent-side EPIPE / ECONNRESET
	// doesn't surface as a Node unhandledException before readline has
	// a chance to attach its own listeners. Deliberately do NOT call
	// resume() here — that would drain bytes the downstream readline
	// expects to read as the handshake line.
	if (process.stdin) {
		process.stdin.on("error", () => {});
	}
} else {
	installMainDiagnostics();
}
const mainLog = getAppLogger("main");
const rendererCdp = configureRendererCdp({
	isCliMode,
	isPackaged: app.isPackaged,
	devServerUrl: process.env.VETTA_DESKTOP_DEV_URL,
	portValue: process.env.VETTA_DEBUG_CDP_PORT,
});
process.env[VETTA_HOME_ENV] = getVettaHomePath();

if (isCliMode) {
	const cliUserDataDir =
		ocrCliCommand !== null
			? "vetta-ocr-cli"
			: pdfCliCommand !== null
				? "vetta-pdf-cli"
				: actionCliCommand !== null
					? `vetta-action-cli-${process.pid}`
					: helpCliCommand !== null
						? `vetta-help-cli-${process.pid}`
						: `vetta-agent-rpc-${process.pid}`;
	app.setPath("userData", join(tmpdir(), cliUserDataDir));
	app.commandLine.appendSwitch("disable-gpu");
	app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
	app.commandLine.appendSwitch("disk-cache-size", "0");
	// Linux: the CLI/agent-rpc child is a headless Electron spawned from
	// within the parent Electron (im-gateway → coding-agent-spec bin =
	// process.execPath + --agent-rpc). Chromium's setuid/namespace sandbox
	// frequently fails to initialize for such a nested spawn (no suid
	// chrome-sandbox, restricted unprivileged user namespaces), and
	// `app.whenReady()` then never resolves — the IM host sees a 10s
	// "handshake timed out" with no child stderr because runAgentRpcCommand
	// runs inside whenReady(). The child renders no untrusted web content,
	// so disabling the sandbox here is safe. `disable-dev-shm-usage` avoids
	// the related /dev/shm-too-small hang on minimal Linux setups.
	if (process.platform === "linux") {
		app.commandLine.appendSwitch("no-sandbox");
		app.commandLine.appendSwitch("disable-dev-shm-usage");
	}
	// CLI mode is agent-driven: keep stderr clean of Electron's dev-time
	// security advisories so callers can rely on stderr being structured
	// NDJSON progress + errors only.
	process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

// 开发模式下 app.name/version 默认来自 Electron 框架，需要手动覆盖
if (!app.isPackaged) {
	app.name = "Vetta";
}

let ipcTeardown: IpcTeardown | undefined;
let teardownSchedulerIpc: (() => void) | undefined;
let teardownBatchTasksIpc: (() => void) | undefined;
let localRpcServer: DesktopLocalRpcServerHandle | undefined;
let appMonitorInitializationPromise: Promise<void> | undefined;

function ensureAppMonitorInitialized(): Promise<void> {
	appMonitorInitializationPromise ??= initializeAppMonitor();
	return appMonitorInitializationPromise;
}

function attachMainWindowLifecycle(mainWindow: BrowserWindow): void {
	const sendWindowMaximizedChanged = () => {
		mainWindow.webContents.send("vetta:window:maximized-changed", mainWindow.isMaximized());
	};
	mainWindow.on("maximize", sendWindowMaximizedChanged);
	mainWindow.on("unmaximize", sendWindowMaximizedChanged);

	// On macOS: close button hides window (follows macOS platform convention)
	// On Windows/Linux: close button hides to tray
	mainWindow.on("close", (event) => {
		if (isMac) {
			const appAny = app as typeof app & { isQuitting?: boolean };
			if (!appAny.isQuitting) {
				event.preventDefault();
				getMainWindow()?.hide();
				return;
			}
		} else if (getHideToTrayOnClose() && getTray()) {
			const appAny = app as typeof app & { isQuitting?: boolean };
			if (!appAny.isQuitting) {
				event.preventDefault();
				getMainWindow()?.hide();
				rebuildTrayContextMenu();
			}
		}
	});

	mainWindow.on("closed", () => {
		setMainWindow(null);
		if (ipcTeardown) {
			teardownAllIpc(ipcTeardown);
			ipcTeardown = undefined;
		}
		if (teardownSchedulerIpc) {
			teardownSchedulerIpc();
			teardownSchedulerIpc = undefined;
		}
		if (teardownBatchTasksIpc) {
			teardownBatchTasksIpc();
			teardownBatchTasksIpc = undefined;
		}
	});
}

// Register custom protocol for OAuth callback
// Windows dev mode: must pass electron.exe path and app entry as args,
// otherwise the URL gets interpreted as a module path.
if (!isCliMode) {
	if (!app.isPackaged && process.platform === "win32") {
		app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [devMainEntryPath]);
	} else {
		app.setAsDefaultProtocolClient(PROTOCOL);
	}
}

function handleProtocolUrl(rawUrl: string): void {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.hostname === "oauth" && parsed.pathname.startsWith("/callback")) {
			const mainWindow = getMainWindow();
			if (!mainWindow) return;
			// state 不匹配时 tokens 为 null——绝不把未校验的 token 转给渲染层，
			// 只通知它把「等待授权」切回可重试状态，否则用户会一直干等。
			const tokens = consumeOAuthCallback(parsed);
			if (tokens) {
				mainWindow.webContents.send("vetta:auth:oauth-callback", tokens);
			} else {
				mainWindow.webContents.send("vetta:auth:oauth-rejected");
			}
		}
	} catch {
		// Ignore malformed URLs
	}
}

// macOS: app may already be running when protocol URL is opened
app.on("open-url", (event, url) => {
	event.preventDefault();
	handleProtocolUrl(url);
	const mainWindow = getMainWindow();
	if (mainWindow) {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	}
});

// Windows/Linux: second instance passes URL via argv
const gotSingleLock = isCliMode ? true : app.requestSingleInstanceLock();
if (!gotSingleLock) {
	app.exit(0);
} else {
	app.on("second-instance", (_event, argv) => {
		const protocolUrl = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
		if (protocolUrl) {
			handleProtocolUrl(protocolUrl);
		}
		showMainWindow();
	});
	app.whenReady().then(async () => {
		if (pdfCliCommand) {
			const exitCode = await runPdfCliCommand(pdfCliCommand);
			// `app.quit()` does not honour `process.exitCode` reliably on macOS —
			// the graceful-quit flow can race with stdio flush and end up reporting
			// 0. Use `app.exit()` for headless one-shot CLI invocations.
			app.exit(exitCode);
			return;
		}

		if (ocrCliCommand) {
			const exitCode = await runOcrCliCommand(ocrCliCommand);
			app.exit(exitCode);
			return;
		}

		if (actionCliCommand) {
			const exitCode = await runActionCliCommand(actionCliCommand);
			app.exit(exitCode);
			return;
		}

		if (helpCliCommand) {
			const exitCode = runHelpCliCommand();
			app.exit(exitCode);
			return;
		}

		if (agentRpcArgs) {
			// agent-rpc 子进程会发出 LLM 网络请求；macOS 15 Local Network
			// Privacy 在 socket 层拦截 Node 默认 fetch 对 192.168.x / 10.x
			// 等私网地址的访问，OpenAI/Anthropic SDK 在这种情况下只能抛
			// "Connection error."。必须复用主进程对话页同款的两步规避：
			// 先触发 TCC 探针让 com.vetta.desktop 拿到 LAN 授权，再把
			// globalThis.fetch 换成 electron.net.fetch（Chromium 网络栈，
			// 不被 LNP 拦截）。PDF / OCR CLI 不需要这条，因为它们不发
			// 跨进程网络请求。
			registerLocalNetworkAccess();
			installChromiumFetchForMain();
			const exitCode = await runAgentRpcCommand(agentRpcArgs);
			app.exit(exitCode);
			return;
		}

		mainLog.info("diagnostics log", getDiagnosticsLogPath());
		mainLog.info("ready", {
			isPackaged: app.isPackaged,
			appPath: app.getAppPath(),
			resourcesPath: process.resourcesPath,
			execPath: process.execPath,
			argv: process.argv,
		});

		// 在创建任何窗口/托盘菜单之前同步定语言：读 desktop-config.language
		//（system | zh | en；缺省 = system）。托盘菜单与系统通知据此取文案（ADR-0031）。
		initAppLanguage();
		// 必须在 createWindow 之前注册：renderer preload 一加载就 sendSync 取初值，
		// 若晚于 createWindow 注册会与异步 page-load 抢跑、读到 undefined 回落错语言（首帧闪）。
		// i18n IPC 与具体窗口无关（广播给全部窗口），故脱离 registerAllIpc 独立早注册、app 级常驻。
		registerI18nIpc();
		const appLifecycle = registerAppLifecycleIpc();

		// 必须放在 whenReady 之后：早于 ready 调用时主进程 bundle identity
		// 尚未在 launchd/TCC 子系统注册，syscall 关联不到 com.vetta.desktop，
		// 探针白发。
		registerLocalNetworkAccess();

		// 走 Chromium 网络栈替代 Node undici，绕过 macOS 15 LNP 对裸 socket 的拦截。
		// 必须在 ready 之后调用（net.fetch 依赖 session）。
		installChromiumFetchForMain();
		registerPluginProtocols();
		registerThemeProtocol();
		registerAppAssetProtocol();

		// 媒体流协议 handler（scheme 已在 ready 前声明特权）
		registerMediaProtocolHandler();
		// 静态文件协议 handler（ADR-0027）
		registerFileProtocolHandler();

		// 直接加载真实 renderer，但先保持窗口隐藏。renderer 恢复持久化主题并绘制
		// theme-ui 启动骨架后通知主进程，再显示窗口，避免独立启动页与最终主题脱节。
		const rendererBootStartedAt = Date.now();
		const mainWindow = createWindow();
		attachMainWindowLifecycle(mainWindow);
		void loadMainWindow(mainWindow);
		const rendererBootPaintPromise = appLifecycle.waitForRendererBootPaint();
		const rendererContentPaintPromise = appLifecycle.waitForRendererContentPaint();
		void rendererBootPaintPromise.then((result) => {
			if (mainWindow.isDestroyed()) return;
			mainWindow.show();
			mainLog.info("renderer boot frame visible", {
				durationMs: Date.now() - rendererBootStartedAt,
				result,
			});
		});

		// 开发模式：每次启动清空 HTTP 缓存。插件资源走 vetta-plugin://，remoteEntry.js
		// 是固定文件名，Chromium 会启发式缓存它——重编译后旧缓存仍 pin 着旧 chunk，
		// 重启也不清（持久化在 userData）。dev 下清缓存代价是重新拉一次本地资源，可忽略；
		// 打包版不清（versioned 资源该缓存）。配合协议响应的 no-store 双保险。
		if (!app.isPackaged) {
			await session.defaultSession.clearCache();
		}
		// 提前发现系统插件（ADR-0024）：填充 id 集合供协议解析，staging 不完整时早告警。
		discoverSystemPlugins();

		const initializeSandbox = async (): Promise<void> => {
			const sandboxProbeStartedAt = Date.now();
			const capability = await initializeSandboxCapability();
			mainLog.info("sandbox startup probe", capability, { durationMs: Date.now() - sandboxProbeStartedAt });
		};
		// sandbox 会在首次请求 sandbox mode 时按需探测；主动预热放到真实内容绘制后，
		// 避免与 renderer 首屏和会话恢复竞争。

		// 开发模式下覆盖 About 面板信息，避免显示 Electron 框架版本
		if (!app.isPackaged) {
			const appVersion = getAppVersion();
			app.setAboutPanelOptions({
				applicationName: "Vetta",
				applicationVersion: appVersion,
				version: "",
			});
		}

		// Theme IPC
		ipcMain.handle("vetta:theme:set", (_event, mode: string) => {
			nativeTheme.themeSource = mode as "system" | "light" | "dark";
			const mainWindow = getMainWindow();
			if (mainWindow) {
				const isDark = mode === "dark" || (mode === "system" && nativeTheme.shouldUseDarkColors);
				mainWindow.setVibrancy(isDark ? "sidebar" : "sidebar");
			}
		});

		ipcMain.handle("vetta:theme:get-native", () => {
			return {
				source: nativeTheme.themeSource,
				shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
			};
		});

		nativeTheme.on("updated", () => {
			const mainWindow = getMainWindow();
			if (mainWindow) {
				if (!isMac) {
					mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#161616" : "#f5f5f7");
				}
				mainWindow.webContents.send("vetta:theme:native-changed", {
					shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
				});
			}
		});

		ipcMain.handle("vetta:shell:show-in-folder", async (_event, fullPath: string) => {
			await shell.openPath(fullPath);
		});

		ipcMain.handle("vetta:shell:show-item-in-folder", (_event, fullPath: string) => {
			shell.showItemInFolder(fullPath);
		});

		ipcMain.handle("vetta:shell:open-external", async (_event, url: string) => {
			await openExternalUrl(url);
		});

		ipcMain.handle("vetta:window:minimize", () => {
			getMainWindow()?.minimize();
		});

		ipcMain.handle("vetta:window:maximize", () => {
			const mainWindow = getMainWindow();
			if (mainWindow?.isMaximized()) {
				mainWindow.unmaximize();
			} else {
				mainWindow?.maximize();
			}
		});

		ipcMain.handle("vetta:window:close", () => {
			getMainWindow()?.close();
		});

		ipcMain.handle("vetta:window:is-maximized", () => {
			return getMainWindow()?.isMaximized() ?? false;
		});

		ipcMain.handle("vetta:window:toggle-always-on-top", () => {
			const mainWindow = getMainWindow();
			if (!mainWindow) return false;
			const next = !mainWindow.isAlwaysOnTop();
			mainWindow.setAlwaysOnTop(next);
			return next;
		});

		ipcMain.handle("vetta:window:is-always-on-top", () => {
			return getMainWindow()?.isAlwaysOnTop() ?? false;
		});

		// 截取窗口内指定区域（DIP 坐标）为 PNG 并经保存对话框落盘。
		// 供「移动UI预览」插件导出渲染图：iframe 内容跨源，渲染端画不出来，
		// 只能由 Chromium 合成器整体截屏。返回保存路径，取消返回 null。
		ipcMain.handle(
			"vetta:window:capture-region",
			async (
				event,
				rect: { x: number; y: number; width: number; height: number },
				defaultFileName: string,
			): Promise<string | null> => {
				const win = getMainWindow();
				if (!win) return null;
				const image = await event.sender.capturePage({
					x: Math.max(0, Math.round(rect.x)),
					y: Math.max(0, Math.round(rect.y)),
					width: Math.max(1, Math.round(rect.width)),
					height: Math.max(1, Math.round(rect.height)),
				});
				const { canceled, filePath } = await dialog.showSaveDialog(win, {
					defaultPath: join(app.getPath("downloads"), defaultFileName),
					filters: [{ name: "PNG", extensions: ["png"] }],
				});
				if (canceled || !filePath) return null;
				await writeFile(filePath, image.toPNG());
				return filePath;
			},
		);

		ipcMain.handle("vetta:tray:set-quit-behavior", (_event, hideToTray: boolean) => {
			setHideToTrayOnClose(hideToTray);
		});

		ipcMain.handle("vetta:tray:get-quit-behavior", () => {
			return getHideToTrayOnClose();
		});

		ipcMain.handle("vetta:tray:set-tooltip", (_event, tooltip: string) => {
			getTray()?.setToolTip(tooltip);
		});

		ipcMain.handle("vetta:auth:open-external", async (_event, url: string) => {
			await openExternalUrl(url);
		});

		// 授权登录由主进程发起：state 的生成与校验都在这里，渲染层碰不到，
		// 未通过校验的 token 也就永远进不了渲染层。
		ipcMain.handle("vetta:auth:start-oauth", async () => {
			await startOAuthLogin();
		});

		ipcMain.handle("vetta:auth:reopen-oauth", async () => {
			await reopenOAuthLogin();
		});

		if (process.platform === "darwin") {
			app.dock.setIcon(nativeImage.createFromPath(join(buildDir, "icon-dock.png")));
		}

		// 默认「对话」项目目录：保证一直存在。
		// 顺带把 in-tree session 目录（<cwd>/.vetta/sessions）也建好，
		// 让默认项目走与批量项目一致的会话布局，避免设备相关的编码路径。
		try {
			await mkdir(join(getVettaHomePath(), "conversation", ".vetta", "sessions"), { recursive: true });
		} catch (err) {
			mainLog.error("failed to ensure default conversation dir", err);
		}

		// im-gateway 独立 cwd（ADR-0005）：跟桌面「对话」物理分家。先把空目录建好，
		// 这样 sidecar 启动前 desktop 的 Claw tab 也能正常 listSessions（拿到空列表）。
		try {
			await mkdir(join(getVettaHomePath(), "im-gateway", "conversation", ".vetta", "sessions"), {
				recursive: true,
			});
		} catch (err) {
			mainLog.error("failed to ensure im-gateway conversation dir", err);
		}

		// 托管运行时(ADR-0011):首启从内置 vendor 拷贝 node/python 到 ~/.vetta/runtimes,
		// 再把它们 + 国内镜像源注入全局 process.env。必须早于 getImHost().bootstrap()——
		// 快速应用已经存在的托管运行时路径；vendor seed、系统探测和 shim 修复放到
		// 首帧之后执行，避免这些维护工作阻塞窗口出现。
		const runtimeManager = getRuntimeManager();
		runtimeManager.applyEnv();
		const initializeManagedRuntimeAndCli = async (): Promise<void> => {
			try {
				const runtimeStartedAt = Date.now();
				await runtimeManager.initialize();
				runtimeManager.applyEnv();
				mainLog.info("runtime startup initialization complete", { durationMs: Date.now() - runtimeStartedAt });
			} catch (err) {
				mainLog.error("runtime manager init failed", err);
			}

			try {
				let vettaAppPath: string;
				let vettaCliPath: string;
				if (app.isPackaged) {
					vettaAppPath = process.execPath;
					vettaCliPath = packagedCliAppPath;
				} else {
					vettaAppPath = await ensureDevCliShim({
						appRoot,
						electronPath: process.execPath,
						mainEntryPath: devMainEntryPath,
					});
					vettaCliPath = await ensureDevVettaCliShim({
						appRoot,
						cliAppRoot: join(appRoot, "..", "cli-app"),
					});
				}
				process.env.VETTA_DESKTOP_EXE = vettaAppPath;
				process.env.VETTA_CLI_APP_PATH = vettaCliPath;
				await ensureVettaCommandShim(vettaCliPath);
				await persistVettaCliPaths({ vettaAppPath, vettaCliAppPath: vettaCliPath });
			} catch (err) {
				mainLog.error("failed to install vetta CLI paths", err);
			}
		};

		if (mainWindow.isDestroyed()) return;
		const actionApprovalBroker = new ActionApprovalBroker(mainWindow.webContents);
		const batchTaskService = initializeDesktopBatchTaskService(getSharedRuntime);
		// 批量项目元数据参与恢复会话的 scenario 判定，需要尽早加载；初始化 Promise
		// 本身不作为 appLifecycle ready 的门闩。
		const batchTaskReadyPromise = batchTaskService.initialize();
		const schedulerService = initializeDesktopSchedulerService({
			getRuntime: getSharedRuntime,
			scheduleTask: scheduleTaskInCron,
			unscheduleTask: unscheduleTaskInCron,
		});
		const actionSystem = createAppActionSystem(actionApprovalBroker);
		const pluginActionService = new PluginActionService(mainWindow.webContents, actionSystem.catalog);

		// Register IPC handlers
		ipcTeardown = registerAllIpc(mainWindow.webContents, { actionApprovalBroker, pluginActionService });
		teardownBatchTasksIpc = registerBatchTasksIpc(mainWindow.webContents, batchTaskService, batchTaskReadyPromise);
		// 知识库手动操作 IPC 只做桥接，先注册以保证 renderer 不会遇到缺失 handler；
		// 后台 poller 等真实内容绘制后再启动。
		registerKnowledgeIpc();
		appLifecycle.markReady();

		app.on("activate", () => {
			showMainWindow();
		});

		// 本地 RPC 与 scheduler 可能在窗口内容完成前收到外部请求，保持尽早启动；
		// 它们位于 markReady 之后，不再构成 renderer 的全局门闩。
		void startDesktopLocalRpcServer(
			{
				actions: createActionRpcRuntime(actionSystem.runtime),
				debug: app.isPackaged ? undefined : createDebugRpcRuntime(createAppDebugRuntime({ rendererCdp })),
			},
			{
				endpointFilePath: getLocalRpcServerEndpointFilePath(),
			},
		)
			.then((server) => {
				localRpcServer = server;
				mainLog.info("local RPC server ready", {
					transport: server.endpoint.transport,
					url: server.endpoint.url,
					debugEnabled: !app.isPackaged,
				});
			})
			.catch((err: unknown) => {
				mainLog.error("failed to start local RPC server", err);
			});

		if (teardownSchedulerIpc) {
			teardownSchedulerIpc();
			teardownSchedulerIpc = undefined;
		}
		void initScheduler().then(() => {
			const win = getMainWindow();
			if (win) {
				teardownSchedulerIpc = registerSchedulerIpc(win.webContents, schedulerService);
			}
		});

		// 托盘属于桌面应用生命周期入口，需要及时可用，但创建不再位于 ready 之前。
		createTray();

		void rendererContentPaintPromise
			.then((contentPaintResult) => {
				if (mainWindow.isDestroyed()) return;
				mainLog.info("renderer content frame visible", {
					durationMs: Date.now() - rendererBootStartedAt,
					result: contentPaintResult,
				});

				// App Monitor 是纯旁路能力：迁移和历史统计读取不得阻塞 renderer 或业务 IPC。
				void ensureAppMonitorInitialized().catch((error: unknown) => {
					mainLog.warn("app monitor background initialization failed", error);
				});

				const deferredStartupTimer = setTimeout(() => {
					void Promise.all([initializeManagedRuntimeAndCli(), initializeSandbox()]).catch((error: unknown) => {
						mainLog.error("deferred startup initialization failed", error);
					});
				}, 500);
				deferredStartupTimer.unref?.();

				initializePetWindow();
				startPetIdleGuard();
				// 快捷面板：预创建隐藏窗口（按需 show/hide，不每次重建），随后据配置启停双击功能键监听。
				// registerAllIpc 已注册快捷面板 IPC（含 RELOAD_HOTKEY），这里仅补窗口与初次触发器同步。
				createQuickPanelWindow();
				void syncQuickPanelTrigger().catch((err) => {
					mainLog.error("failed to sync quick panel trigger", err);
				});
				// Appshot：据配置启停「双键同按」手势监听（与快捷面板共享 uiohook 单例）。
				void syncAppshotGesture().catch((err) => {
					mainLog.error("failed to sync appshot gesture", err);
				});

				// 启动 Updater：绑定主窗口并在打包环境后台检查一次
				updaterService.setMainWindow(mainWindow);
				void updaterService.onAppReady();

				void reloadKnowledgePoller().catch((err) => {
					mainLog.error("failed to start knowledge poller:", err);
				});

				// Bootstrap IM bridge subsystem (im-gateway sidecar). Errors during
				// bootstrap are non-fatal — IM is an opt-in feature and the rest of
				// the desktop-app must keep working.
				void getImHost()
					.bootstrap()
					.catch((err: unknown) => {
						mainLog.error("im-host bootstrap failed", err);
					});
			})
			.catch((error: unknown) => {
				mainLog.error("post-renderer startup failed", error);
			});
	});
}

app.on("window-all-closed", () => {
	if (isCliMode) return;
	if (process.platform !== "darwin") {
		app.quit();
	}
});

// Critical: ensure IM sidecar is killed before the main process exits.
// `before-quit` runs before window destruction, giving us a synchronous
// hook to wait on graceful child shutdown.
// 标记：避免 before-quit 在调用 app.exit() 后再次触发本 handler 时
// 又陷进异步清理流程。
let quitCleanupStarted = false;

app.on("before-quit", async (event) => {
	if (isCliMode) return;
	if (quitCleanupStarted) return;
	quitCleanupStarted = true;
	(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
	event.preventDefault();

	// 退出前注销全部全局键盘监听消费者（快捷面板双击 + appshot 双键同按），避免 uiohook 线程残留。
	stopAllUiohookConsumers();

	// 停掉插件工作台 dev 热更新的 vite watch 子进程，避免孤儿进程。
	stopAllPluginDevWatches();

	const host = getImHost();
	if (host.getStatus().sidecarPid) {
		try {
			await host.shutdownForQuit();
		} catch (err) {
			mainLog.error("im-host shutdown failed", err);
		}
	}
	// 退出前统一释放共享 RuntimeHost 持有的所有 session 文件锁，
	// 避免 .lock 残留，下次启动还要靠 stale-detection 才能回收。
	try {
		await disposeSharedRuntime();
	} catch (err) {
		mainLog.error("disposeSharedRuntime failed", err);
	}
	if (localRpcServer) {
		try {
			await localRpcServer.close();
		} catch (err) {
			mainLog.error("local RPC server shutdown failed", err);
		}
		localRpcServer = undefined;
	}
	try {
		await ensureAppMonitorInitialized();
		await shutdownAppMonitor();
	} catch (err) {
		mainLog.warn("app monitor shutdown failed", err);
	}
	await shutdownMainTelemetry();
	app.exit(0);
});
