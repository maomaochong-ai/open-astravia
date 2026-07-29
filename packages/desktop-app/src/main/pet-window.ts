import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions, screen } from "electron";
import { PET_ACTIONS } from "../shared/pet-actions.js";
import { getPetBubbleStyle, type PetBubbleStyleId } from "../shared/pet-bubbles.js";
import {
	DEFAULT_PET_CONFIG,
	getPetScaledVideoSize,
	getPetVideoBaseSize,
	getPetVideoScaleForSize,
	normalizePetConfig,
	normalizePetSize,
	normalizePetVideoScale,
	normalizePetVideoSize,
	normalizePetVideoSizeForWindow,
	PET_SIZE_MAX,
	PET_SIZE_STEP,
	PET_VIDEO_SIZE_STEP,
	type PetConfig,
} from "../shared/pet-config.js";
import {
	PET_COMMAND_CHANNEL,
	type PetCommand,
	type PetContentBounds,
	type PetResizeCorner,
	type PetVideoHitbox,
} from "../shared/pet-ipc.js";
import { mainT } from "./i18n/index.js";
import { allowProjectRoot } from "./ipc/fs.js";
import { getAppLogger } from "./logger.js";
import { MEDIA_PROTOCOL_SCHEME } from "./media-protocol.js";
import { readPetConfigSync, writePetConfig } from "./pet-config-store.js";
import { iconPath } from "./window-manager.js";

const log = getAppLogger("pet-window");
const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
const resDir = app.isPackaged ? appRoot : join(appRoot, "dist");
const buildDir = app.isPackaged ? join(process.resourcesPath, "build") : join(appRoot, "build");
const petMediaDir = join(buildDir, "pet");
const devServerUrl = process.env.VETTA_DESKTOP_DEV_URL;
const petPreloadPath = join(resDir, "preload/pet.js");
const PET_SCREEN_EDGE_MARGIN = 24;

let petWindow: BrowserWindow | null = null;
let petConfig: PetConfig = DEFAULT_PET_CONFIG;
let persistSizeTimer: ReturnType<typeof setTimeout> | undefined;
let windowMoveSession: PetWindowMoveSession | undefined;
let windowResizeSession: PetWindowResizeSession | undefined;
let isMousePassthroughEnabled = false;
let petVideoHitbox: PetVideoHitbox | undefined;
let petContentOffset = { x: 0, y: 0 };
let mousePassthroughPollTimer: ReturnType<typeof setInterval> | undefined;

type PetWindowResizeSession = {
	corner: PetResizeCorner;
};

type PetWindowMoveSession = {
	startAnchor: Electron.Point;
	startCursor: Electron.Point;
	lastCursor: Electron.Point;
};

type PetVideoResolution = {
	id: string;
	fileName: string;
	path: string;
	found: boolean;
	url?: string;
};

function resolvePetVideo(action: (typeof PET_ACTIONS)[number]): PetVideoResolution {
	const videoPath = join(petMediaDir, action.fileName);
	if (!existsSync(videoPath)) {
		return {
			id: action.id,
			fileName: action.fileName,
			path: videoPath,
			found: false,
		};
	}
	return {
		id: action.id,
		fileName: action.fileName,
		path: videoPath,
		found: true,
		url: `${MEDIA_PROTOCOL_SCHEME}://local/stream?path=${encodeURIComponent(videoPath)}&kind=video`,
	};
}

function resolvePetBubbleDecorUrl(styleId: PetBubbleStyleId): string | undefined {
	const decor = getPetBubbleStyle(styleId).decor;
	if (!decor) return undefined;

	const decorPath = join(petMediaDir, decor.fileName);
	if (!existsSync(decorPath)) return undefined;
	return `${MEDIA_PROTOCOL_SCHEME}://local/stream?path=${encodeURIComponent(decorPath)}`;
}

function getStoredPetConfig(): PetConfig {
	return readPetConfigSync();
}

function getInitialBounds(): Electron.Rectangle {
	return screen.getPrimaryDisplay().workArea;
}

function buildPetQuery(config: PetConfig, contentOffset: Electron.Point): string {
	const params = new URLSearchParams();
	const bubbleDecorUrl = resolvePetBubbleDecorUrl(config.bubbleStyleId);
	params.set("bubbleStyle", config.bubbleStyleId);
	if (bubbleDecorUrl) params.set("bubbleDecor", bubbleDecorUrl);
	for (const action of PET_ACTIONS) {
		const video = resolvePetVideo(action);
		if (video.url) {
			params.set(action.id, video.url);
		}
		params.set(`${action.id}VideoBaseSize`, String(getPetVideoBaseSize(config, action.id)));
	}
	params.set("videoScale", String(config.videoScale));
	params.set("autoMode", String(config.autoMode));
	params.set("debugFrame", String(config.debugFrame));
	// 首屏定位走 URL，避免 did-finish-load 的 set-content-offset 与 React 监听注册竞态后卡在中心。
	params.set("contentOffsetX", String(contentOffset.x));
	params.set("contentOffsetY", String(contentOffset.y));
	return params.toString();
}

function getInitialPetContentOffset(bounds: Electron.Rectangle, size: number): Electron.Point {
	const halfSize = normalizePetSize(size) / 2;
	return {
		x: Math.round(bounds.width / 2 - halfSize - PET_SCREEN_EDGE_MARGIN),
		y: Math.round(bounds.height / 2 - halfSize - PET_SCREEN_EDGE_MARGIN),
	};
}

function constrainPetContentOffset(bounds: Electron.Rectangle, offset: Electron.Point): Electron.Point {
	const fallbackHalfSize = normalizePetSize(petConfig.size) / 2;
	const halfWidth = petVideoHitbox ? petVideoHitbox.width / 2 : fallbackHalfSize;
	const halfHeight = petVideoHitbox ? petVideoHitbox.height / 2 : fallbackHalfSize;
	const maxX = Math.max(0, bounds.width / 2 - halfWidth - PET_SCREEN_EDGE_MARGIN);
	const maxY = Math.max(0, bounds.height / 2 - halfHeight - PET_SCREEN_EDGE_MARGIN);
	return {
		x: Math.round(Math.min(Math.max(offset.x, -maxX), maxX)),
		y: Math.round(Math.min(Math.max(offset.y, -maxY), maxY)),
	};
}

function getPetAnchorScreenPoint(win: BrowserWindow): Electron.Point {
	const bounds = win.getBounds();
	return {
		x: Math.round(bounds.x + bounds.width / 2 + petContentOffset.x),
		y: Math.round(bounds.y + bounds.height / 2 + petContentOffset.y),
	};
}

function setPetOverlayBounds(win: BrowserWindow, bounds: Electron.Rectangle): void {
	const current = win.getBounds();
	if (
		current.x === bounds.x &&
		current.y === bounds.y &&
		current.width === bounds.width &&
		current.height === bounds.height
	) {
		return;
	}
	win.setBounds(bounds, false);
}

function sendPetContentOffset(win: BrowserWindow, offset: { x: number; y: number }, force = false): void {
	const x = Math.round(offset.x);
	const y = Math.round(offset.y);
	const changed = petContentOffset.x !== x || petContentOffset.y !== y;
	if (!changed && !force) return;
	if (changed && petVideoHitbox) {
		petVideoHitbox = {
			...petVideoHitbox,
			x: petVideoHitbox.x + x - petContentOffset.x,
			y: petVideoHitbox.y + y - petContentOffset.y,
		};
	}
	petContentOffset = { x, y };
	sendPetCommand(win, { type: "set-content-offset", x, y });
}

async function persistPetWindowSize(size: number): Promise<void> {
	const nextSize = normalizePetSize(size);
	if (petConfig.size === nextSize) return;
	petConfig = { ...petConfig, size: nextSize };
	await writePetConfig(petConfig);
}

function schedulePersistPetWindowSize(size: number): void {
	if (persistSizeTimer) {
		clearTimeout(persistSizeTimer);
	}
	persistSizeTimer = setTimeout(() => {
		persistSizeTimer = undefined;
		void persistPetWindowSize(size);
	}, 300);
}

async function persistPetVideoScale(scale: number): Promise<void> {
	const nextScale = normalizePetVideoScale(scale);
	if (petConfig.videoScale === nextScale) return;
	petConfig = { ...petConfig, videoScale: nextScale };
	await writePetConfig(petConfig);
}

async function persistPetVideoBaseSize(actionId: (typeof PET_ACTIONS)[number]["id"], baseSize: number): Promise<void> {
	const nextBaseSize = normalizePetVideoSizeForWindow(baseSize, PET_SIZE_MAX);
	if (getPetVideoBaseSize(petConfig, actionId) === nextBaseSize) return;
	petConfig = {
		...petConfig,
		videoBaseSizeByAction: {
			...petConfig.videoBaseSizeByAction,
			[actionId]: nextBaseSize,
		},
	};
	await writePetConfig(petConfig);
}

function getPetEntryUrl(query: string): string {
	if (devServerUrl) {
		return query.length > 0 ? `${devServerUrl}/pet.html?${query}` : `${devServerUrl}/pet.html`;
	}
	const petEntryUrl = pathToFileURL(join(resDir, "renderer/pet.html"));
	petEntryUrl.search = query;
	return petEntryUrl.toString();
}

function loadPetEntry(win: BrowserWindow): void {
	const initialOffset = getInitialPetContentOffset(win.getBounds(), petConfig.size);
	petContentOffset = initialOffset;
	const query = buildPetQuery(petConfig, initialOffset);
	const url = getPetEntryUrl(query);
	log.info("load entry", {
		mode: devServerUrl ? "dev-server" : "file",
		devServerUrl,
		url,
		contentOffset: initialOffset,
	});
	const loadPromise = win.loadURL(url);

	void loadPromise.catch((error: unknown) => {
		log.error("loadURL failed", error);
	});
}

function sendPetCommand(win: BrowserWindow, command: PetCommand): void {
	win.webContents.send(PET_COMMAND_CHANNEL, command);
}

export function sendPetCommandToWindow(command: PetCommand): void {
	if (!petWindow || petWindow.isDestroyed()) return;
	sendPetCommand(petWindow, command);
}

function syncPetOverlayToAnchor(win: BrowserWindow, anchor = getPetAnchorScreenPoint(win)): void {
	const workArea = screen.getDisplayNearestPoint(anchor).workArea;
	setPetOverlayBounds(win, workArea);
	const nextOffset = constrainPetContentOffset(workArea, {
		x: anchor.x - workArea.x - workArea.width / 2,
		y: anchor.y - workArea.y - workArea.height / 2,
	});
	sendPetContentOffset(win, nextOffset);
}

function isCursorOverPetVideo(win: BrowserWindow): boolean {
	if (!petVideoHitbox) return false;
	const cursor = screen.getCursorScreenPoint();
	const bounds = win.getBounds();
	const x = cursor.x - bounds.x;
	const y = cursor.y - bounds.y;
	return (
		x >= petVideoHitbox.x &&
		x <= petVideoHitbox.x + petVideoHitbox.width &&
		y >= petVideoHitbox.y &&
		y <= petVideoHitbox.y + petVideoHitbox.height
	);
}

function syncPetMousePassthroughForCursor(): void {
	if (!petWindow || petWindow.isDestroyed()) return;
	if (windowMoveSession) {
		setPetMousePassthrough(false);
		return;
	}
	setPetMousePassthrough(!isCursorOverPetVideo(petWindow));
}

function startMousePassthroughPolling(): void {
	if (mousePassthroughPollTimer) return;
	mousePassthroughPollTimer = setInterval(syncPetMousePassthroughForCursor, 50);
}

function stopMousePassthroughPolling(): void {
	if (!mousePassthroughPollTimer) return;
	clearInterval(mousePassthroughPollTimer);
	mousePassthroughPollTimer = undefined;
}

function shouldShowPetDevToolsMenuItem(): boolean {
	return !app.isPackaged || process.env.VETTA_PET_DEVTOOLS === "1";
}

async function closePetFromContextMenu(win: BrowserWindow): Promise<void> {
	const nextConfig = { ...petConfig, enabled: false };
	await writePetConfig(nextConfig);
	petConfig = nextConfig;
	if (!win.isDestroyed()) {
		win.close();
	}
}

function showContextMenu(win: BrowserWindow): void {
	const alwaysOnTop = win.isAlwaysOnTop();
	const template: MenuItemConstructorOptions[] = [
		{
			label: "动作",
			submenu: [
				...PET_ACTIONS.map((action) => ({
					label: action.label,
					click: () => {
						sendPetCommand(win, { type: "set-action", actionId: action.id, source: "user", holdMs: 10_000 });
					},
				})),
				{ type: "separator" as const },
				{
					label: "随机动作",
					click: () => {
						sendPetCommand(win, { type: "random-action", source: "user", holdMs: 10_000 });
					},
				},
			],
		},
		{
			label: "自动切换",
			type: "checkbox",
			checked: petConfig.autoMode,
			click: (menuItem) => {
				petConfig = { ...petConfig, autoMode: menuItem.checked };
				sendPetCommand(win, { type: "set-auto-mode", enabled: petConfig.autoMode });
			},
		},
		{ type: "separator" },
		{
			label: "隐藏桌宠",
			click: () => win.hide(),
		},
		{
			label: alwaysOnTop ? "取消置顶" : "保持置顶",
			click: () => {
				win.setAlwaysOnTop(!alwaysOnTop, "screen-saver");
			},
		},
		...(shouldShowPetDevToolsMenuItem()
			? [
					{ type: "separator" as const },
					{
						label: mainT("pet.openDevTools"),
						click: () => {
							win.webContents.openDevTools({ mode: "detach" });
						},
					},
				]
			: []),
		{ type: "separator" },
		{
			label: "关闭桌宠",
			click: () => {
				void closePetFromContextMenu(win).catch((error: unknown) => {
					log.error("close from context menu failed", error);
					if (!win.isDestroyed()) {
						win.close();
					}
				});
			},
		},
	];
	Menu.buildFromTemplate(template).popup({ window: win });
}

export function getPetWindow(): BrowserWindow | null {
	return petWindow;
}

export function getPetConfig(): PetConfig {
	return petConfig;
}

export function initializePetWindow(): BrowserWindow | null {
	petConfig = getStoredPetConfig();
	if (!petConfig.enabled) {
		log.info("startup skipped", petConfig);
		return null;
	}
	return createPetWindow();
}

export function createPetWindow(): BrowserWindow {
	petConfig = getStoredPetConfig();
	if (petWindow && !petWindow.isDestroyed()) {
		log.info("reuse existing window", {
			isVisible: petWindow.isVisible(),
			bounds: petWindow.getBounds(),
		});
		return petWindow;
	}

	const initialBounds = getInitialBounds();
	allowProjectRoot(petMediaDir);
	const videos = PET_ACTIONS.map(resolvePetVideo);
	const foundVideos = videos.filter((video) => video.found);
	log.info("create requested", {
		isPackaged: app.isPackaged,
		appRoot,
		resDir,
		buildDir,
		petMediaDir,
		devServerUrl,
		initialBounds,
		foundVideos: foundVideos.map((video) => video.fileName),
		missingVideos: videos.filter((video) => !video.found).map((video) => video.fileName),
		petConfig,
	});

	petWindow = new BrowserWindow({
		...initialBounds,
		frame: false,
		resizable: false,
		movable: false,
		show: false,
		skipTaskbar: true,
		transparent: true,
		enableLargerThanScreen: process.platform === "darwin",
		hasShadow: false,
		alwaysOnTop: petConfig.alwaysOnTop,
		backgroundColor: "#00000000",
		icon: iconPath[process.platform],
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: petPreloadPath,
		},
	});

	isMousePassthroughEnabled = false;
	setPetMousePassthrough(true);
	petWindow.setAlwaysOnTop(petConfig.alwaysOnTop, "screen-saver");
	// macOS: 默认情况下 setVisibleOnAllWorkspaces 会在 UIElementApplication 与
	// ForegroundApplication 之间切换进程类型（transformProcessType），每次调用都会短暂
	// 隐藏窗口和 Dock —— 这正是桌宠开启时的卡顿/闪烁、Dock 图标消失，以及 dev 下 devtools
	// 打不开（进程重新向窗口服务器注册、焦点被打断）的根因。`screen-saver` 层级已能浮在全屏
	// 应用之上，故用 skipTransformProcessType 跳过这次转换，既保留全屏浮层又不丢 Dock、不卡顿。
	petWindow.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: true,
	});
	petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	petWindow.webContents.on("preload-error", (_event, preloadPathForError, error) => {
		log.error("preload-error", { preloadPath: preloadPathForError, error });
	});
	petWindow.webContents.on("context-menu", (event) => {
		event.preventDefault();
		if (!petWindow || petWindow.isDestroyed()) return;
		showContextMenu(petWindow);
	});
	petWindow.on("system-context-menu", (event) => {
		event.preventDefault();
		if (!petWindow || petWindow.isDestroyed()) return;
		showContextMenu(petWindow);
	});
	const handleDisplayMetricsChanged = () => {
		if (!petWindow || petWindow.isDestroyed()) return;
		syncPetOverlayToAnchor(petWindow);
	};
	screen.on("display-added", handleDisplayMetricsChanged);
	screen.on("display-removed", handleDisplayMetricsChanged);
	screen.on("display-metrics-changed", handleDisplayMetricsChanged);
	petWindow.on("ready-to-show", () => {
		if (!petWindow || petWindow.isDestroyed()) return;
		petWindow.showInactive();
		log.info("ready-to-show", {
			isVisible: petWindow.isVisible(),
			bounds: petWindow.getBounds(),
			isAlwaysOnTop: petWindow.isAlwaysOnTop(),
		});
	});
	petWindow.webContents.on("did-finish-load", () => {
		if (!petWindow || petWindow.isDestroyed()) return;
		sendPetContentOffset(petWindow, getInitialPetContentOffset(petWindow.getBounds(), petConfig.size), true);
		log.info("did-finish-load", {
			url: petWindow.webContents.getURL(),
			isVisible: petWindow.isVisible(),
			bounds: petWindow.getBounds(),
		});
	});
	petWindow.on("closed", () => {
		screen.off("display-added", handleDisplayMetricsChanged);
		screen.off("display-removed", handleDisplayMetricsChanged);
		screen.off("display-metrics-changed", handleDisplayMetricsChanged);
		stopMousePassthroughPolling();
		petVideoHitbox = undefined;
		petContentOffset = { x: 0, y: 0 };
		windowMoveSession = undefined;
		windowResizeSession = undefined;
		isMousePassthroughEnabled = false;
		petWindow = null;
		log.info("closed");
	});
	petWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
		log.error("did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
			isMainFrame,
		});
	});

	loadPetEntry(petWindow);
	return petWindow;
}

export function showPetWindow(): BrowserWindow {
	const win = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
	if (!win.isVisible()) {
		win.showInactive();
	}
	log.info("show requested", {
		isVisible: win.isVisible(),
		bounds: win.getBounds(),
	});
	return win;
}

export function applyPetConfig(config: PetConfig): void {
	petConfig = normalizePetConfig(config);

	if (!petConfig.enabled) {
		if (petWindow && !petWindow.isDestroyed()) {
			petWindow.hide();
		}
		log.debug("config applied hidden", petConfig);
		return;
	}

	const win = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
	win.setAlwaysOnTop(petConfig.alwaysOnTop, "screen-saver");
	if (!win.isVisible()) {
		win.showInactive();
	}
	sendPetCommand(win, { type: "set-auto-mode", enabled: petConfig.autoMode });
	sendPetCommand(win, { type: "set-debug-frame", enabled: petConfig.debugFrame });
	sendPetCommand(win, { type: "set-video-scale", scale: petConfig.videoScale });
	const bubbleDecorUrl = resolvePetBubbleDecorUrl(petConfig.bubbleStyleId);
	sendPetCommand(win, {
		type: "set-bubble-style",
		styleId: petConfig.bubbleStyleId,
		...(bubbleDecorUrl ? { decorUrl: bubbleDecorUrl } : {}),
	});
	for (const action of PET_ACTIONS) {
		sendPetCommand(win, {
			type: "set-video-base-size",
			actionId: action.id,
			baseSize: getPetVideoBaseSize(petConfig, action.id),
		});
	}
	log.debug("config applied", {
		petConfig,
		isVisible: win.isVisible(),
		bounds: win.getBounds(),
	});
}

export async function resizePetWindowByWheel(deltaY: number): Promise<void> {
	if (typeof deltaY !== "number" || !Number.isFinite(deltaY) || deltaY === 0) return;
	const win = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
	const direction = deltaY < 0 ? 1 : -1;
	const nextSize = normalizePetSize(petConfig.size + direction * PET_SIZE_STEP);
	if (nextSize === petConfig.size) return;
	await persistPetWindowSize(nextSize);
	sendPetContentOffset(win, constrainPetContentOffset(win.getBounds(), petContentOffset));
}

export function beginPetWindowMove(): void {
	const win = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
	const startCursor = screen.getCursorScreenPoint();
	windowMoveSession = {
		startAnchor: getPetAnchorScreenPoint(win),
		startCursor,
		lastCursor: startCursor,
	};
}

export function movePetWindow(): void {
	const session = windowMoveSession;
	if (!session) return;
	const win = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
	const cursor = screen.getCursorScreenPoint();
	if (cursor.x === session.lastCursor.x && cursor.y === session.lastCursor.y) return;

	const anchor = {
		x: Math.round(session.startAnchor.x + cursor.x - session.startCursor.x),
		y: Math.round(session.startAnchor.y + cursor.y - session.startCursor.y),
	};
	windowMoveSession = { ...session, lastCursor: cursor };
	syncPetOverlayToAnchor(win, anchor);
}

export function endPetWindowMove(): void {
	windowMoveSession = undefined;
	syncPetMousePassthroughForCursor();
}

export function beginPetWindowResize(corner: PetResizeCorner): void {
	windowResizeSession = {
		corner,
	};
}

export async function setPetWindowSize(size: number, corner?: PetResizeCorner): Promise<void> {
	if (!Number.isFinite(size)) return;
	const nextSize = normalizePetSize(size);
	const session = windowResizeSession && windowResizeSession.corner === corner ? windowResizeSession : undefined;
	if (session) {
		return;
	}
	schedulePersistPetWindowSize(nextSize);
}

export function setPetWindowContentSize(content: number | PetContentBounds): void {
	void content;
}

export async function endPetWindowResize(size: number): Promise<void> {
	windowResizeSession = undefined;
	if (!Number.isFinite(size)) return;
	const nextSize = normalizePetSize(size);
	await persistPetWindowSize(nextSize);
}

export async function resizePetVideoByWheel(
	actionId: (typeof PET_ACTIONS)[number]["id"],
	deltaY: number,
): Promise<void> {
	if (typeof deltaY !== "number" || !Number.isFinite(deltaY) || deltaY === 0) return;
	const win = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
	const direction = deltaY < 0 ? 1 : -1;
	const currentSize = getPetScaledVideoSize(petConfig, actionId);
	const nextSize = normalizePetVideoSize(currentSize + direction * PET_VIDEO_SIZE_STEP);
	const nextScale = getPetVideoScaleForSize(petConfig, actionId, nextSize);
	if (nextScale === petConfig.videoScale) return;
	await persistPetVideoScale(nextScale);
	sendPetCommand(win, {
		type: "set-video-scale",
		scale: nextScale,
	});
}

export function setPetMousePassthrough(enabled: boolean): void {
	const win = petWindow && !petWindow.isDestroyed() ? petWindow : undefined;
	if (!win) return;
	if (enabled && windowMoveSession) return;
	if (isMousePassthroughEnabled === enabled) return;
	isMousePassthroughEnabled = enabled;
	// 穿透时不要用 { forward: true }：forward 仍会把 mousemove 送进桌宠页，
	// 全屏透明层的 CSS cursor（如 cursor-move）会与下层主窗口光标互相抢写，
	// 表现为鼠标移动时在 move/default 之间闪烁。命中检测改由主进程
	// syncPetMousePassthroughForCursor 轮询 screen 光标 + video hitbox 完成。
	if (enabled) {
		win.setIgnoreMouseEvents(true);
	} else {
		win.setIgnoreMouseEvents(false);
	}
}

export function setPetVideoHitbox(hitbox: PetVideoHitbox | undefined): void {
	const win = petWindow && !petWindow.isDestroyed() ? petWindow : undefined;
	const bounds = win?.getBounds();
	if (hitbox && bounds && hitbox.width > 0 && hitbox.height > 0) {
		const left = Math.max(0, Math.round(hitbox.x));
		const top = Math.max(0, Math.round(hitbox.y));
		const right = Math.min(bounds.width, Math.round(hitbox.x + hitbox.width));
		const bottom = Math.min(bounds.height, Math.round(hitbox.y + hitbox.height));
		petVideoHitbox =
			right > left && bottom > top
				? {
						x: left,
						y: top,
						width: right - left,
						height: bottom - top,
					}
				: undefined;
	} else {
		petVideoHitbox = undefined;
	}
	if (petVideoHitbox) {
		if (win && bounds) {
			sendPetContentOffset(win, constrainPetContentOffset(bounds, petContentOffset));
		}
		startMousePassthroughPolling();
		syncPetMousePassthroughForCursor();
		return;
	}
	stopMousePassthroughPolling();
	setPetMousePassthrough(true);
}

export async function setPetVideoBaseSize(
	actionId: (typeof PET_ACTIONS)[number]["id"],
	baseSize: number,
): Promise<void> {
	const win = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
	const nextBaseSize = normalizePetVideoSizeForWindow(baseSize, PET_SIZE_MAX);
	await persistPetVideoBaseSize(actionId, nextBaseSize);
	sendPetCommand(win, {
		type: "set-video-base-size",
		actionId,
		baseSize: nextBaseSize,
	});
}
