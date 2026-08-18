import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, screen } from "electron";
import type { GlassOptions } from "electron-liquid-glass";
import { QUICK_PANEL_CHANNELS, type QuickPanelGlassMode } from "../shared/quickpanel-ipc.js";
import { getAppLogger } from "./logger.js";
import { iconPath } from "./window-manager.js";

const log = getAppLogger("quickpanel-window");
const isMac = process.platform === "darwin";

// electron-liquid-glass 是 darwin-only 原生模块（node-gyp-build 仅含 mac prebuild）。
// 顶层模块 eval 即加载 .node，在 Windows/Linux 上会抛错。主进程 bundle 在 mac 上
// 一次构建、跨平台打包，同一份 import 语句会在所有平台执行，故只能在 macOS 上按需
// require，避免非 mac 启动崩溃（见 ADR-0036）。
interface LiquidGlassApi {
	addView(handle: Buffer, options?: GlassOptions): number;
	isGlassSupported(): boolean;
	// experimental 私有 API：0=regular（默认，浅色下偏实心），1=clear（更通透）。
	unstable_setVariant(id: number, variant: number): void;
}
// 液态玻璃材质：clear 比默认 regular 更通透，避免浅色模式下玻璃显得实心。
const GLASS_VARIANT_CLEAR = 1;
const requireNative = createRequire(import.meta.url);
const liquidGlass: LiquidGlassApi | null = isMac ? (requireNative("electron-liquid-glass") as LiquidGlassApi) : null;
const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
const resDir = app.isPackaged ? appRoot : join(appRoot, "dist");
const devServerUrl = process.env.VETTA_DESKTOP_DEV_URL;
const quickPanelPreloadPath = join(resDir, "preload/quickpanel.js");

const QUICK_PANEL_WIDTH = 640;
// 高度贴合内容：输入框(48) + 分隔线(1) + 「最近会话」标题(~28) + 5 个 item 滚动区(250) + 外层 p-2(16)。
// 列表固定 5 项高度、超出滚动（见 RecentList），故窗口高度恒定。
const QUICK_PANEL_HEIGHT = 344;
// 面板距离工作区顶部约 20%。
const QUICK_PANEL_TOP_RATIO = 0.2;
// 原生玻璃圆角，需与渲染层卡片 rounded-2xl(16px) 对齐。
const QUICK_PANEL_GLASS_CORNER_RADIUS = 16;

let quickPanelWindow: BrowserWindow | null = null;
// 当前面板背景玻璃模式；macOS 上由原生层判定（液态/磨砂），非 mac 为 none。
let glassMode: QuickPanelGlassMode = "none";
// 每个窗口仅 addView 一次：原生玻璃视图挂在原生窗口上、与 web 内容无关，
// 重复 addView（如 dev HMR 重载）会层叠多张玻璃。
let glassApplied = false;

// 在 macOS 上为面板窗口挂载原生玻璃视图（玻璃绘制在 web 内容之下）。
// macOS 26+ 得到液态玻璃，更低版本由库自动回退为磨砂玻璃；非 mac 为 no-op。
function applyQuickPanelGlass(win: BrowserWindow): void {
	if (glassApplied) return;
	glassMode = "none";
	if (!liquidGlass) return;
	try {
		const id = liquidGlass.addView(win.getNativeWindowHandle(), {
			cornerRadius: QUICK_PANEL_GLASS_CORNER_RADIUS,
			opaque: false,
		});
		if (id < 0) return;
		glassApplied = true;
		glassMode = liquidGlass.isGlassSupported() ? "liquid" : "frosted";
		// 仅液态玻璃（macOS 26+）支持材质变体；切到 clear 让浅色模式更通透。
		if (glassMode === "liquid") {
			try {
				liquidGlass.unstable_setVariant(id, GLASS_VARIANT_CLEAR);
			} catch (variantError) {
				log.warn("liquid glass setVariant failed", variantError);
			}
		}
		log.info("glass applied", { glassMode });
	} catch (error) {
		log.error("liquid glass addView failed", error);
	}
}

// 把当前玻璃模式下发给面板渲染层，使其据此切换卡片背景（透明/不透明）。
function sendQuickPanelGlassMode(win: BrowserWindow): void {
	if (!win.webContents.isDestroyed()) {
		win.webContents.send(QUICK_PANEL_CHANNELS.ON_GLASS, glassMode);
	}
}

function getQuickPanelEntryUrl(): string {
	if (devServerUrl) {
		return `${devServerUrl}/quickpanel.html`;
	}
	return pathToFileURL(join(resDir, "renderer/quickpanel.html")).toString();
}

function loadQuickPanelEntry(win: BrowserWindow): void {
	const url = getQuickPanelEntryUrl();
	log.info("load entry", {
		mode: devServerUrl ? "dev-server" : "file",
		devServerUrl,
		url,
	});
	void win.loadURL(url).catch((error: unknown) => {
		log.error("loadURL failed", error);
	});
}

// 把面板定位到光标所在显示器：水平居中、距顶部约 20%。
function positionQuickPanelWindow(win: BrowserWindow): void {
	const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const { workArea } = display;
	const x = Math.round(workArea.x + (workArea.width - QUICK_PANEL_WIDTH) / 2);
	const y = Math.round(workArea.y + workArea.height * QUICK_PANEL_TOP_RATIO);
	win.setBounds({ x, y, width: QUICK_PANEL_WIDTH, height: QUICK_PANEL_HEIGHT });
}

export function getQuickPanelWindow(): BrowserWindow | null {
	return quickPanelWindow;
}

export function createQuickPanelWindow(): BrowserWindow {
	if (quickPanelWindow && !quickPanelWindow.isDestroyed()) {
		return quickPanelWindow;
	}

	glassApplied = false;
	log.info("create requested", {
		isPackaged: app.isPackaged,
		appRoot,
		resDir,
		devServerUrl,
		quickPanelPreloadPath,
	});

	quickPanelWindow = new BrowserWindow({
		width: QUICK_PANEL_WIDTH,
		height: QUICK_PANEL_HEIGHT,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		hasShadow: false,
		resizable: false,
		movable: true,
		show: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		fullscreenable: false,
		minimizable: false,
		maximizable: false,
		icon: iconPath[process.platform],
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: quickPanelPreloadPath,
		},
	});

	quickPanelWindow.setAlwaysOnTop(true, "floating");
	if (isMac) {
		quickPanelWindow.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
			skipTransformProcessType: true,
		});
	}
	quickPanelWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	// 禁用面板内的刷新/重载（Cmd+R、Shift+Cmd+R 等）。App 用 Electron 默认菜单，
	// reload/forceReload 是菜单 role（mac 上优先级高于 before-input-event，拦不住），
	// 故直接把本 webContents 的 reload 方法 no-op。否则重载瞬间 React 以默认
	// glassMode=none 先渲染不透明卡片，盖住下面仍在的原生玻璃，中间「闪一下实心」。
	const panelWebContents = quickPanelWindow.webContents;
	panelWebContents.reload = () => {};
	panelWebContents.reloadIgnoringCache = () => {};
	// F5（部分平台）经键盘直达，用 before-input-event 兜底拦下。
	panelWebContents.on("before-input-event", (event, input) => {
		const key = input.key.toLowerCase();
		if (key === "f5" || ((input.meta || input.control) && key === "r")) {
			event.preventDefault();
		}
	});
	quickPanelWindow.webContents.on("did-finish-load", () => {
		if (quickPanelWindow && !quickPanelWindow.isDestroyed()) {
			applyQuickPanelGlass(quickPanelWindow);
			sendQuickPanelGlassMode(quickPanelWindow);
		}
	});
	quickPanelWindow.webContents.on("preload-error", (_event, preloadPathForError, error) => {
		log.error("preload-error", { preloadPath: preloadPathForError, error });
	});
	quickPanelWindow.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
			log.error("did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame });
		},
	);
	quickPanelWindow.on("blur", () => {
		hideQuickPanelWindow();
	});
	quickPanelWindow.on("closed", () => {
		quickPanelWindow = null;
		log.info("closed");
	});

	loadQuickPanelEntry(quickPanelWindow);
	return quickPanelWindow;
}

export function showQuickPanelWindow(): void {
	const win = quickPanelWindow && !quickPanelWindow.isDestroyed() ? quickPanelWindow : createQuickPanelWindow();
	positionQuickPanelWindow(win);
	win.show();
	win.focus();
	if (!win.webContents.isDestroyed()) {
		win.webContents.send(QUICK_PANEL_CHANNELS.ON_SHOWN);
		// 每次唤出补发玻璃模式，避免渲染层错过首帧 did-finish-load 推送。
		sendQuickPanelGlassMode(win);
	}
	log.info("show requested", { bounds: win.getBounds() });
}

export function hideQuickPanelWindow(): void {
	if (!quickPanelWindow || quickPanelWindow.isDestroyed()) return;
	if (!quickPanelWindow.isVisible()) return;
	quickPanelWindow.hide();
	log.info("hide requested");
}

export function toggleQuickPanelWindow(): void {
	if (quickPanelWindow && !quickPanelWindow.isDestroyed() && quickPanelWindow.isVisible()) {
		hideQuickPanelWindow();
		return;
	}
	showQuickPanelWindow();
}
