import type {
	ConversationScenario,
	PluginActivityTabContribution,
	PluginCardRendererContribution,
	PluginFileExplorerContextMenuContribution,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerToolbarContribution,
	PluginFilePreviewContribution,
	PluginInputActionContribution,
	PluginLocales,
	PluginPromptAttachment,
	PluginToolCallSlotContribution,
	PluginTurnCardContribution,
} from "@vetta-org/plugin-sdk";
import { atom, getDefaultStore } from "jotai";

/** A loaded plugin's i18n catalogs + fallback locale, keyed by plugin id. */
export interface PluginI18nEntry {
	locales: PluginLocales;
	defaultLocale: string;
}

/**
 * Per-plugin i18n registry, published by PluginGlobalSlotHost from loaded
 * plugins. Drives `%key%` resolution for host-rendered contribution strings
 * (activity-tab/input-action labels) and the __PluginI18nContext that backs
 * `useTranslation` in plugin components (ADR-0033).
 */
export const pluginI18nByIdAtom = atom<Record<string, PluginI18nEntry>>({});

/** A file-preview contribution registered by a loaded plugin. */
export interface RegisteredFilePreview {
	/** Owning plugin id, for dedup/debugging. */
	pluginId: string;
	/** Lower-case extensions (no dot) this preview handles. */
	extensions: string[];
	component: PluginFilePreviewContribution["component"];
}

/**
 * Flat list of plugin file-preview registrations, published by
 * PluginGlobalSlotHost and consumed by FilePreviewView. First match wins.
 */
export const pluginFilePreviewsAtom = atom<RegisteredFilePreview[]>([]);

export interface RegisteredFileExplorerContextMenuAction extends PluginFileExplorerContextMenuContribution {
	pluginId: string;
	actionId: string;
}

export interface RegisteredFileExplorerToolbarAction extends PluginFileExplorerToolbarContribution {
	pluginId: string;
	actionId: string;
}

export interface RegisteredFileExplorerDecorationProvider extends PluginFileExplorerDecorationProvider {
	pluginId: string;
	providerId: string;
}

export const pluginFileExplorerContextMenuActionsAtom = atom<RegisteredFileExplorerContextMenuAction[]>([]);
export const pluginFileExplorerToolbarActionsAtom = atom<RegisteredFileExplorerToolbarAction[]>([]);
export const pluginFileExplorerDecorationProvidersAtom = atom<RegisteredFileExplorerDecorationProvider[]>([]);

/** An activity-tab contribution registered by a loaded plugin（可添加池条目）. */
export interface RegisteredActivityTab {
	pluginId: string;
	/** Owning plugin display name, shown as the picker row subtitle. */
	pluginName: string;
	tabId: string;
	label: string;
	icon?: PluginActivityTabContribution["icon"];
	component: PluginActivityTabContribution["component"];
	/** 允许出现的对话场景（fail-closed：缺省/空 = 任何会话都不显示）。见契约。 */
	scope_use?: PluginActivityTabContribution["scope_use"];
	/** 注册后是否默认上栏（缺省 true）；false = 出现条件由插件自己驱动。 */
	initiallyVisible?: PluginActivityTabContribution["initiallyVisible"];
	/** 未激活时仍保留组件实例，适用于内嵌浏览器、编辑器等有状态运行时。 */
	keepAliveWhenAvailable?: PluginActivityTabContribution["keepAliveWhenAvailable"];
}

/**
 * 活动面板插件 tab 的「可添加池」，由 PluginGlobalSlotHost 发布、ActivityPanel
 * 消费。注册不直接渲染——attach 记录 ∩ 此池才渲染为 tab。
 */
export const pluginActivityTabsAtom = atom<RegisteredActivityTab[]>([]);

/** An input-action (toggle) contribution registered by a loaded plugin. */
export interface RegisteredInputAction {
	pluginId: string;
	/** Namespaced id (`${pluginId}:${contributionId}`). */
	actionId: string;
	label: string;
	icon?: PluginInputActionContribution["icon"];
	defaultActive?: boolean;
	/** 依赖的 agent 工具名；仅当其在当前会话激活时显示该 badge（见契约）。 */
	requiresActiveTool?: PluginInputActionContribution["requiresActiveTool"];
	/** 允许出现的对话场景（fail-closed：缺省/空 = 任何会话都不显示）。见契约。 */
	scope_use?: PluginInputActionContribution["scope_use"];
	/** When true, hide this plugin's activity tabs while the toggle is off (ADR-0041). */
	hardIsolation?: boolean;
	onToggle?: PluginInputActionContribution["onToggle"];
	decoratePrompt?: PluginInputActionContribution["decoratePrompt"];
}

/** Input-action toggles shown beneath the AI input bar, published by PluginGlobalSlotHost. */
export const pluginInputActionsAtom = atom<RegisteredInputAction[]>([]);

/**
 * 当前「正在查看」会话的 input-action 工作集（插件 toggle ids）。
 * 按会话隔离的真相源是 {@link sessionInputActionStateMapAtom}；本 atom 只是
 * 当前会话的投影，供发送 / Activity 硬隔离 / InputActionBar 读取。
 */
export const activeInputActionIdsAtom = atom<Set<string>>(new Set<string>());

/**
 * 原生「知识检索」开关（非插件输入动作，硬隔离）。开启后下一次发送携带
 * `metadata.knowledgeMode`：input-pipeline 对本轮暴露 kb-read 工具并注入
 * 仅模型可见的「优先查询知识库」提示。未开启时本轮剥离 kb-read 工具
 * （`kb_list_available_tags` / `kb_filter_by_tags`），agent 无法调用。
 * 与插件 input-action 一样按会话独立持久化（见 sessionInputActionStateMapAtom）。
 */
export const knowledgeRetrievalActiveAtom = atom<boolean>(false);

/** 单会话 AI 输入栏 toggle 持久化快照。 */
export interface SessionInputActionState {
	/** Active plugin input-action ids（namespaced `${pluginId}:${id}`）。 */
	actionIds: string[];
	/** 宿主内置「知识检索」开关。 */
	knowledgeRetrieval: boolean;
}

export const SESSION_INPUT_ACTIONS_STORAGE_KEY = "vetta-session-input-actions";

function normalizeSessionInputActionState(raw: unknown): SessionInputActionState | null {
	if (raw == null || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const actionIds = Array.isArray(record.actionIds)
		? record.actionIds.filter((id): id is string => typeof id === "string" && id.length > 0)
		: [];
	return {
		actionIds,
		knowledgeRetrieval: record.knowledgeRetrieval === true,
	};
}

function loadSessionInputActionStateMap(): Record<string, SessionInputActionState> {
	try {
		const raw = localStorage.getItem(SESSION_INPUT_ACTIONS_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (parsed == null || typeof parsed !== "object") return {};
		const map: Record<string, SessionInputActionState> = {};
		for (const [sessionPath, value] of Object.entries(parsed)) {
			if (!sessionPath) continue;
			const state = normalizeSessionInputActionState(value);
			if (!state) continue;
			// 跳过全空条目，避免 map 无限膨胀。
			if (state.actionIds.length === 0 && !state.knowledgeRetrieval) continue;
			map[sessionPath] = state;
		}
		return map;
	} catch {
		return {};
	}
}

const sessionInputActionStateMapBaseAtom = atom<Record<string, SessionInputActionState>>(
	loadSessionInputActionStateMap(),
);

/**
 * sessionPath → 该会话 AI 输入栏 toggle 状态。写入时同步 localStorage，
 * 刷新 / 切页 / 切会话后可恢复（runtimeId 进程内才有效，故用 sessionPath）。
 */
export const sessionInputActionStateMapAtom = atom(
	(get) => get(sessionInputActionStateMapBaseAtom),
	(_get, set, next: Record<string, SessionInputActionState>) => {
		set(sessionInputActionStateMapBaseAtom, next);
		try {
			localStorage.setItem(SESSION_INPUT_ACTIONS_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// private mode / quota — 内存态仍可用
		}
	},
);

export function emptySessionInputActionState(): SessionInputActionState {
	return { actionIds: [], knowledgeRetrieval: false };
}

/** 快照当前工作集（activeInputActionIds + knowledgeRetrieval）。 */
export function captureInputActionWorkingState(): SessionInputActionState {
	const store = getDefaultStore();
	return {
		actionIds: [...store.get(activeInputActionIdsAtom)],
		knowledgeRetrieval: store.get(knowledgeRetrievalActiveAtom),
	};
}

/**
 * 把 hardIsolation 插件的 contribution mode 同步到「当前工作集」。
 * 进程级 gate（main `activeContributionModeIds`）只应反映当前可见会话。
 */
export function syncHardIsolationContributionModes(activeIds: ReadonlySet<string>): void {
	const store = getDefaultStore();
	const byPlugin = new Map<string, boolean>();
	for (const action of store.get(pluginInputActionsAtom)) {
		if (!action.hardIsolation) continue;
		const on = activeIds.has(action.actionId);
		byPlugin.set(action.pluginId, (byPlugin.get(action.pluginId) ?? false) || on);
	}
	for (const [pluginId, active] of byPlugin) {
		void window.vetta.plugins.setContributionMode(pluginId, active);
	}
}

/** 写入当前工作集 atom，并同步 hardIsolation contribution mode。 */
export function applyInputActionWorkingState(state: SessionInputActionState): void {
	const store = getDefaultStore();
	store.set(activeInputActionIdsAtom, new Set(state.actionIds));
	store.set(knowledgeRetrievalActiveAtom, state.knowledgeRetrieval);
	syncHardIsolationContributionModes(new Set(state.actionIds));
}

export function loadInputActionStateForSession(sessionPath: string): SessionInputActionState {
	if (!sessionPath) return emptySessionInputActionState();
	return getDefaultStore().get(sessionInputActionStateMapAtom)[sessionPath] ?? emptySessionInputActionState();
}

/** 将状态写入 map（空状态则删键）；sessionPath 为空时 no-op。 */
export function persistInputActionStateForSession(sessionPath: string, state: SessionInputActionState): void {
	if (!sessionPath) return;
	const store = getDefaultStore();
	const prev = store.get(sessionInputActionStateMapAtom);
	const isEmpty = state.actionIds.length === 0 && !state.knowledgeRetrieval;
	if (isEmpty) {
		if (!(sessionPath in prev)) return;
		const next = { ...prev };
		delete next[sessionPath];
		store.set(sessionInputActionStateMapAtom, next);
		return;
	}
	const existing = prev[sessionPath];
	if (
		existing &&
		existing.knowledgeRetrieval === state.knowledgeRetrieval &&
		existing.actionIds.length === state.actionIds.length &&
		existing.actionIds.every((id, index) => id === state.actionIds[index])
	) {
		return;
	}
	store.set(sessionInputActionStateMapAtom, { ...prev, [sessionPath]: state });
}

/** 把当前工作集落到指定 sessionPath（toggle / 切会话时调用）。 */
export function persistCurrentInputActionState(sessionPath: string | null | undefined): void {
	if (!sessionPath) return;
	persistInputActionStateForSession(sessionPath, captureInputActionWorkingState());
}

/**
 * 知识库总开关（镜像 desktop config 的 knowledgeBase.enabled，缺省关）。
 * 关闭后：隐藏「知识检索」按钮、agent 屏蔽知识库工具、停后台加工。
 * 由 useAppInit 启动同步、设置页保存时更新。
 */
export const knowledgeBaseEnabledAtom = atom<boolean>(false);

/**
 * 当前会话「激活（模型可见）的工具名集合」，由 useSessionManager 在打开会话时从
 * getState 的快照写入。`null` = 未知（新建会话页 / 尚未加载）→ 输入栏 badge 回退显示。
 * 非 null 时 badge 按其对应工具是否在集合内决定显示，跟随工具的 scope_use，消除双真相源漂移。
 */
export const activeToolNamesAtom = atom<Set<string> | null>(null);

/**
 * 当前会话的对话场景，由 useSessionManager 在打开会话时从 getState 快照写入。
 * `null` = 未知（新建会话页 / 尚未加载）。会话页插件插槽（活动面板标签卡 / 输入栏 toggle）
 * 据此按对话类型 **fail-closed** 显隐：仅当 scenario 已知且在该插槽的 scope_use 内才显示。
 */
export const currentScenarioAtom = atom<ConversationScenario | null>(null);

/** A card renderer registered by a loaded plugin, keyed by `type`. */
export interface RegisteredCardRenderer {
	pluginId: string;
	/** Plugin-owned, globally-unique card type (matches a descriptor's `type`). */
	type: string;
	component: PluginCardRendererContribution["component"];
	/** Default tab label (a descriptor's `title` overrides this). */
	title?: string;
	/** Default tab icon (React node). */
	icon?: PluginCardRendererContribution["icon"];
	/** Synthesizes a provisional descriptor for an in-flight tool call. */
	pendingFor?: PluginCardRendererContribution["pendingFor"];
}

/**
 * Card renderers published by PluginGlobalSlotHost, consumed by the per-message
 * card host. The host resolves each card descriptor's `type` to one of these.
 */
export const pluginCardRenderersAtom = atom<RegisteredCardRenderer[]>([]);

/** A plugin renderer that replaces the default transcript UI for a specific tool. */
export interface RegisteredToolCallSlot {
	pluginId: string;
	/** Namespaced id (`${pluginId}:${contributionId}`). */
	slotId: string;
	toolName: string;
	component: PluginToolCallSlotContribution["component"];
}

/** Tool-call renderers keyed by `toolName`. First registered renderer wins. */
export const pluginToolCallSlotsAtom = atom<RegisteredToolCallSlot[]>([]);

/**
 * Labels from `registerTool({ label })`, keyed by LLM tool name.
 * Written directly at registration (not republished via PluginGlobalSlotHost).
 * Chat headers resolve `%key%` against the owning plugin catalog.
 */
export interface RegisteredAgentToolLabel {
	pluginId: string;
	toolName: string;
	/** May be `%catalogKey%` or a literal. */
	label: string;
}

export const pluginAgentToolLabelsAtom = atom<Record<string, RegisteredAgentToolLabel>>({});

/** A turn-card contribution registered by a loaded plugin（消息列表底部插槽）. */
export interface RegisteredTurnCard {
	pluginId: string;
	/** Namespaced id (`${pluginId}:${contributionId}`). */
	cardId: string;
	component: PluginTurnCardContribution["component"];
	/** 允许出现的对话场景（fail-closed：缺省/空 = 任何会话都不显示）。见契约。 */
	scope_use?: PluginTurnCardContribution["scope_use"];
}

/**
 * Turn cards published by PluginGlobalSlotHost, consumed by PluginTurnCardHost in
 * the message-list footer. Not tool-bound — each plugin component owns its own
 * visibility (renders null when inapplicable).
 */
export const pluginTurnCardsAtom = atom<RegisteredTurnCard[]>([]);

/**
 * Plugin-owned context for outgoing prompts. The host renders its label/icon,
 * snapshots structured context at send time, and keeps sticky attachments until
 * explicitly cleared. `null` when nothing is attached.
 */
export interface RegisteredPromptAttachment extends PluginPromptAttachment {
	ownerPluginId: string;
}

export const promptAttachmentAtom = atom<RegisteredPromptAttachment | null>(null);
