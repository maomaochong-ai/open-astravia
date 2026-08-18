// 快捷面板（Quick Panel）主进程 <-> 渲染进程 IPC 契约。
// 同时被 main、panel preload、main preload 引用——通道字符串以此文件为唯一来源，禁止手抄。

export const QUICK_PANEL_CHANNELS = {
	// panel(renderer) -> main (invoke)
	GET_CONFIG: "vetta:quickpanel:get-config",
	CREATE_CONVERSATION: "vetta:quickpanel:create-conversation",
	OPEN_SESSION: "vetta:quickpanel:open-session",
	LIST_RECENT: "vetta:quickpanel:list-recent",
	HIDE: "vetta:quickpanel:hide",
	// main -> panel(renderer) (event / webContents.send)
	ON_SHOWN: "vetta:quickpanel:shown",
	ON_GLASS: "vetta:quickpanel:glass",
	// settings(main renderer) -> main (invoke)
	RELOAD_HOTKEY: "vetta:quickpanel:reload-hotkey",
	// main -> MAIN renderer (event)
	RUN_PROMPT: "vetta:quickpanel:run-prompt",
} as const;

// session.ts 已广播的运行状态通道（面板 preload 直接订阅同名通道）。
// 与 session.ts 中 CHANNELS 的字面量保持一致；Group 3 新增 pending-question 通道。
export const QUICK_PANEL_SESSION_CHANNELS = {
	RUNNING_CHANGED: "vetta:session:running-changed",
	PENDING_QUESTION_CHANGED: "vetta:session:pending-question-changed",
} as const;

export type QuickPanelPostSendBehavior = "foreground" | "background";

/**
 * 面板背景的玻璃模式（由主进程依平台/系统版本判定后下发）：
 * - liquid：macOS 26+ 原生液态玻璃；
 * - frosted：macOS < 26 原生磨砂玻璃（legacy NSVisualEffectView 模糊）；
 * - none：非 macOS，无原生效果，渲染层退回不透明卡片。
 * liquid/frosted 均由原生层在 web 内容之下绘制，故渲染层须把卡片背景设为透明。
 */
export type QuickPanelGlassMode = "liquid" | "frosted" | "none";

/** 双击功能键触发：none=不启用；mod=双击 ⌘/Ctrl；alt=双击 ⌥/Alt；shift=双击 ⇧。 */
export type QuickPanelTriggerKind = "none" | "mod" | "alt" | "shift";

export interface QuickPanelConfigSnapshot {
	trigger: QuickPanelTriggerKind;
	postSendBehavior: QuickPanelPostSendBehavior;
}

export interface QuickPanelSession {
	sessionPath: string;
	cwd: string;
	title: string; // name || firstMessage || fallback
	modifiedAt: number;
	lastMessagePreview: string; // 可能为 ""
}

export interface QuickPanelOpenSessionTarget {
	sessionPath: string;
	cwd: string;
}

export interface QuickPanelRunningChangedEvent {
	sessionPath: string;
	running: boolean;
}

export interface QuickPanelPendingQuestionChangedEvent {
	sessionPath: string;
	hasPendingQuestion: boolean;
}

export interface QuickPanelRunPromptPayload {
	text: string;
	foreground: boolean;
}

// panel preload bridge（window.vettaQuickPanel）
export interface QuickPanelBridge {
	// App 语言真相源（desktop-config）。preload 在暴露前 sendSync 同步取得，供面板 i18n
	// 首帧前读取、与主窗口语言一致（不再用 navigator 猜测）。
	initialLanguage: string;
	getConfig(): Promise<QuickPanelConfigSnapshot>;
	createConversation(text: string): Promise<void>;
	openSession(target: QuickPanelOpenSessionTarget): Promise<void>;
	listRecent(limit?: number): Promise<QuickPanelSession[]>;
	hide(): void;
	onShown(handler: () => void): () => void;
	onGlass(handler: (mode: QuickPanelGlassMode) => void): () => void;
	// App 语言切换广播（all windows），面板据此实时 changeLanguage。
	onLanguageChanged(handler: (lang: string) => void): () => void;
	onRunningChanged(handler: (event: QuickPanelRunningChangedEvent) => void): () => void;
	onPendingQuestionChanged(handler: (event: QuickPanelPendingQuestionChangedEvent) => void): () => void;
}
