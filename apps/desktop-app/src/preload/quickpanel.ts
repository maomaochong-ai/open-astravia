import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import "./telemetry.js";
import {
	QUICK_PANEL_CHANNELS,
	QUICK_PANEL_SESSION_CHANNELS,
	type QuickPanelBridge,
	type QuickPanelConfigSnapshot,
	type QuickPanelGlassMode,
	type QuickPanelOpenSessionTarget,
	type QuickPanelPendingQuestionChangedEvent,
	type QuickPanelRunningChangedEvent,
	type QuickPanelSession,
} from "../shared/quickpanel-ipc.js";

// i18n 通道字面量刻意内联（不 import main/ipc/i18n，避免把主进程模块拉进 preload）。
// 与 src/main/ipc/i18n.ts 保持一致；二者均为全局通道，面板窗口可直接复用。
const I18N_GET_INITIAL = "vetta:i18n:get-initial-language";
const I18N_LANGUAGE_CHANGED = "vetta:i18n:language-changed";

// preload 求值期同步取主进程当前语言（与主窗口同源），供面板 i18n 首帧前读取。
// get-initial 返回 { preference, language }；面板只需要解析后的 language。
function readInitialLanguage(): string {
	const raw = ipcRenderer.sendSync(I18N_GET_INITIAL) as unknown;
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const language = (raw as { language?: unknown }).language;
		if (typeof language === "string" && language.length > 0) return language;
	}
	if (typeof raw === "string" && raw.length > 0 && raw !== "system") return raw;
	return "en";
}

function languageFromChangedPayload(payload: unknown): string {
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		const language = (payload as { language?: unknown }).language;
		if (typeof language === "string" && language.length > 0) return language;
	}
	if (typeof payload === "string" && payload.length > 0 && payload !== "system") return payload;
	return "en";
}

const initialLanguage = readInitialLanguage();

const api: QuickPanelBridge = {
	initialLanguage,
	getConfig(): Promise<QuickPanelConfigSnapshot> {
		return ipcRenderer.invoke(QUICK_PANEL_CHANNELS.GET_CONFIG);
	},
	createConversation(text: string): Promise<void> {
		return ipcRenderer.invoke(QUICK_PANEL_CHANNELS.CREATE_CONVERSATION, text);
	},
	openSession(target: QuickPanelOpenSessionTarget): Promise<void> {
		return ipcRenderer.invoke(QUICK_PANEL_CHANNELS.OPEN_SESSION, target);
	},
	listRecent(limit?: number): Promise<QuickPanelSession[]> {
		return ipcRenderer.invoke(QUICK_PANEL_CHANNELS.LIST_RECENT, limit);
	},
	hide(): void {
		void ipcRenderer.invoke(QUICK_PANEL_CHANNELS.HIDE);
	},
	onShown(handler: () => void): () => void {
		const listener = (_event: IpcRendererEvent) => {
			handler();
		};
		ipcRenderer.on(QUICK_PANEL_CHANNELS.ON_SHOWN, listener);
		return () => ipcRenderer.removeListener(QUICK_PANEL_CHANNELS.ON_SHOWN, listener);
	},
	onGlass(handler: (mode: QuickPanelGlassMode) => void): () => void {
		const listener = (_event: IpcRendererEvent, mode: QuickPanelGlassMode) => {
			handler(mode);
		};
		ipcRenderer.on(QUICK_PANEL_CHANNELS.ON_GLASS, listener);
		return () => ipcRenderer.removeListener(QUICK_PANEL_CHANNELS.ON_GLASS, listener);
	},
	onLanguageChanged(handler: (lang: string) => void): () => void {
		const listener = (_event: IpcRendererEvent, payload: unknown) => {
			handler(languageFromChangedPayload(payload));
		};
		ipcRenderer.on(I18N_LANGUAGE_CHANGED, listener);
		return () => ipcRenderer.removeListener(I18N_LANGUAGE_CHANGED, listener);
	},
	onRunningChanged(handler: (event: QuickPanelRunningChangedEvent) => void): () => void {
		const listener = (_event: IpcRendererEvent, payload: QuickPanelRunningChangedEvent) => {
			handler(payload);
		};
		ipcRenderer.on(QUICK_PANEL_SESSION_CHANNELS.RUNNING_CHANGED, listener);
		return () => ipcRenderer.removeListener(QUICK_PANEL_SESSION_CHANNELS.RUNNING_CHANGED, listener);
	},
	onPendingQuestionChanged(handler: (event: QuickPanelPendingQuestionChangedEvent) => void): () => void {
		const listener = (_event: IpcRendererEvent, payload: QuickPanelPendingQuestionChangedEvent) => {
			handler(payload);
		};
		ipcRenderer.on(QUICK_PANEL_SESSION_CHANNELS.PENDING_QUESTION_CHANGED, listener);
		return () => ipcRenderer.removeListener(QUICK_PANEL_SESSION_CHANNELS.PENDING_QUESTION_CHANGED, listener);
	},
};

contextBridge.exposeInMainWorld("vettaQuickPanel", api);
