import type { ActivityTabKey } from "@shared/lib/project-profile";
import { atom, type Getter, type Setter } from "jotai";

export const activityPanelOpenAtom = atom<boolean>(false);
export const activityPanelResizingAtom = atom<boolean>(false);

export interface FloatingActivityTabPlacement {
	height: number;
	key: ActivityTabKey;
	width: number;
	x: number;
	y: number;
	zIndex: number;
}

/** 浮动 tab 按项目隔离；切换项目时隐藏，返回项目后恢复。 */
export const floatingActivityTabsByProjectAtom = atom<Map<string, FloatingActivityTabPlacement[]>>(new Map());

/** 活动面板默认宽度，也是关闭内嵌预览时回拉的兜底值。 */
export const ACTIVITY_PANEL_DEFAULT_WIDTH = 360;

/** 活动面板可拖拽的最小宽度。 */
export const ACTIVITY_PANEL_MIN_WIDTH = 260;
/**
 * 拉到最大时给主聊天区保留的最小宽度；面板上限 = 窗口宽度 - 此值。
 * 按窗口坐标系计，实际消息区净宽还要扣 AppFrame 的 p-2（16）与聊天列/面板之间的 gap-2（8），
 * 即净宽 ≈ 此值 - 24。取 384 使消息区最窄约 360。
 */
export const ACTIVITY_PANEL_MIN_CHAT_AREA = 384;

/**
 * 文件 tab 内嵌预览的「显示阈值」：面板宽度 ≥ 此值才展示右侧预览框，否则只剩目录树。
 * 拖窄到阈值以下自动收起预览，拖宽回来自动恢复；无选中文件时跨过阈值默认选第一个文件。
 */
export const ACTIVITY_PANEL_PREVIEW_MIN_WIDTH = 520;

export const ACTIVITY_PANEL_WIDTH_STORAGE_KEY = "vetta-activity-panel-width";

/** 当前窗口宽度下，活动面板的最大宽度。 */
export function activityPanelMaxWidth(windowWidth: number): number {
	return Math.max(ACTIVITY_PANEL_MIN_WIDTH, windowWidth - ACTIVITY_PANEL_MIN_CHAT_AREA);
}

/**
 * 面板宽度的**意图**，而非结果：`fixed` 是用户/插件指定的具体像素，`max` 是「跟随窗口拉满」。
 * 只有存意图才能让 `max` 在窗口变大时重新求值——存夹紧后的像素数会让面板只缩不涨。
 * 新增档位（如按比例）时在此加分支，公共插件 API 仍只暴露 `number | "max"`。
 */
export type ActivityPanelWidthMode = { kind: "fixed"; px: number } | { kind: "max" };

/** localStorage 里 `max` 意图的哨兵值；其余情况仍写裸数字，兼容历史记录。 */
const PERSISTED_MAX_WIDTH = "max";

function readPersistedWidthMode(): ActivityPanelWidthMode {
	try {
		const raw = localStorage.getItem(ACTIVITY_PANEL_WIDTH_STORAGE_KEY);
		if (raw == null) return { kind: "fixed", px: ACTIVITY_PANEL_DEFAULT_WIDTH };
		if (raw === PERSISTED_MAX_WIDTH) return { kind: "max" };
		const value = Number(raw);
		if (!Number.isFinite(value)) return { kind: "fixed", px: ACTIVITY_PANEL_DEFAULT_WIDTH };
		return { kind: "fixed", px: Math.max(ACTIVITY_PANEL_MIN_WIDTH, value) };
	} catch {
		return { kind: "fixed", px: ACTIVITY_PANEL_DEFAULT_WIDTH };
	}
}

function persistWidthMode(mode: ActivityPanelWidthMode): void {
	try {
		localStorage.setItem(
			ACTIVITY_PANEL_WIDTH_STORAGE_KEY,
			mode.kind === "max" ? PERSISTED_MAX_WIDTH : String(mode.px),
		);
	} catch {
		// ignore quota / private mode
	}
}

/** 把意图落到当前窗口下的实际像素宽度。 */
export function resolveActivityPanelWidth(mode: ActivityPanelWidthMode, windowWidth: number): number {
	const max = activityPanelMaxWidth(windowWidth);
	if (mode.kind === "max") return max;
	return Math.min(max, Math.max(ACTIVITY_PANEL_MIN_WIDTH, mode.px));
}

function sameWidthMode(a: ActivityPanelWidthMode, b: ActivityPanelWidthMode): boolean {
	if (a.kind === "max") return b.kind === "max";
	return b.kind === "fixed" && a.px === b.px;
}

const initialWidthMode = readPersistedWidthMode();

/** Internal primitive stores; public API is {@link activityPanelWidthAtom} / {@link activityPanelWidthModeAtom}. */
const activityPanelWidthModeBaseAtom = atom<ActivityPanelWidthMode>(initialWidthMode);
const activityPanelWidthBaseAtom = atom(resolveActivityPanelWidth(initialWidthMode, window.innerWidth));

/** 当前宽度意图，只读。判断面板是否处于「跟随窗口拉满」用它。 */
export const activityPanelWidthModeAtom = atom((get) => get(activityPanelWidthModeBaseAtom));

/** 同时更新意图与解析后的像素宽度；夹紧在此统一完成。 */
function applyWidthMode(get: Getter, set: Setter, mode: ActivityPanelWidthMode, persist: boolean): void {
	if (!sameWidthMode(get(activityPanelWidthModeBaseAtom), mode)) set(activityPanelWidthModeBaseAtom, mode);
	const next = resolveActivityPanelWidth(mode, window.innerWidth);
	if (next !== get(activityPanelWidthBaseAtom)) set(activityPanelWidthBaseAtom, next);
	if (persist) persistWidthMode(mode);
}

type ActivityPanelWidthUpdate = number | ((prev: number) => number);

function resolvePanelWidthUpdate(prev: number, update: ActivityPanelWidthUpdate): number {
	return typeof update === "function" ? update(prev) : update;
}

/**
 * 活动面板宽度。读写均经此 atom；写入具体像素即退出「跟随窗口」并同步 localStorage，
 * 避免 reload/热更新后回到默认值。
 */
export const activityPanelWidthAtom = atom(
	(get) => get(activityPanelWidthBaseAtom),
	(get, set, update: ActivityPanelWidthUpdate) => {
		const next = resolvePanelWidthUpdate(get(activityPanelWidthBaseAtom), update);
		applyWidthMode(get, set, { kind: "fixed", px: next }, true);
	},
);

const activityPanelTabDraggingAtom = atom(false);
const pendingActivityPanelWidthAtom = atom<number | "max" | null>(null);

/** 拖拽中的瞬时宽度：实时更新布局，但不在每一帧同步写 localStorage。 */
export const setTransientActivityPanelWidthAtom = atom(null, (get, set, update: ActivityPanelWidthUpdate) => {
	const next = resolvePanelWidthUpdate(get(activityPanelWidthBaseAtom), update);
	applyWidthMode(get, set, { kind: "fixed", px: next }, false);
});

/** 拖拽结束时把最终宽度持久化一次。 */
export const persistActivityPanelWidthAtom = atom(null, (get) => {
	persistWidthMode(get(activityPanelWidthModeBaseAtom));
});

/**
 * 写入活动面板宽度并夹到 [MIN, max] 内。传 "max" 表示「跟随窗口拉满」——它是一种会随
 * 窗口尺寸重新求值的持续状态，直到用户拖动分隔条或有人写入具体像素为止。
 * 供插件 API（openActivityTab 的 width 选项）与 ResizeHandle 复用同一套约束。
 */
export const setActivityPanelWidthAtom = atom(null, (get, set, width: number | "max") => {
	if (get(activityPanelTabDraggingAtom)) {
		set(pendingActivityPanelWidthAtom, width);
		return;
	}
	applyWidthMode(get, set, width === "max" ? { kind: "max" } : { kind: "fixed", px: width }, true);
});

/**
 * 窗口宽度变化时按当前意图重解析：`max` 跟着窗口涨落，`fixed` 在窗口变窄时夹紧、
 * 变宽时回到用户原本指定的宽度。不落盘——意图没变，存的仍是意图。
 */
export const syncActivityPanelWidthToWindowAtom = atom(null, (get, set, windowWidth: number) => {
	const next = resolveActivityPanelWidth(get(activityPanelWidthModeBaseAtom), windowWidth);
	if (next !== get(activityPanelWidthBaseAtom)) set(activityPanelWidthBaseAtom, next);
});

/** Tab 拖拽期间延迟插件宽度请求，结束时只应用最后一次请求。 */
export const setActivityPanelTabDraggingAtom = atom(null, (get, set, dragging: boolean) => {
	set(activityPanelTabDraggingAtom, dragging);
	if (dragging) return;
	const pendingWidth = get(pendingActivityPanelWidthAtom);
	if (pendingWidth == null) return;
	set(pendingActivityPanelWidthAtom, null);
	set(setActivityPanelWidthAtom, pendingWidth);
});

/**
 * 活动面板 active tab 按项目（cwd）记忆。
 * 切换项目后会回到该项目上次选中的 tab；新项目按 profile.defaultActivityTab 决定。
 */
export const activityPanelTabByProjectAtom = atom<Map<string, ActivityTabKey>>(new Map<string, ActivityTabKey>());

/** 从 localStorage 读取 cwd → string[] 形态的持久化记录，解析失败返回空 Map。 */
function readCwdStringListMap(storageKey: string): Map<string, string[]> {
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return new Map();
		const parsed: unknown = JSON.parse(raw);
		if (parsed == null || typeof parsed !== "object") return new Map();
		const map = new Map<string, string[]>();
		for (const [cwd, keys] of Object.entries(parsed)) {
			if (Array.isArray(keys)) {
				map.set(
					cwd,
					keys.filter((key): key is string => typeof key === "string"),
				);
			}
		}
		return map;
	} catch {
		return new Map();
	}
}

/** 构造一个「读取 base / 写入时同步 localStorage」的 cwd → string[] 持久化 atom。 */
function createPersistedCwdStringListAtom(storageKey: string) {
	const base = atom<Map<string, string[]>>(readCwdStringListMap(storageKey));
	return atom(
		(get) => get(base),
		(_get, set, next: Map<string, string[]>) => {
			set(base, next);
			localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(next)));
		},
	);
}

export const ATTACHED_PLUGIN_TABS_STORAGE_KEY = "vetta-activity-plugin-tabs";

/**
 * 活动面板插件 tab 的 attach 记录：会话 cwd → ["pluginId:tabId"]（见 ADR-0026）。
 * 普通项目所有 session 共享项目 cwd → 项目级同步；「对话」项目 per-session 子目录
 * cwd → 天然按 session 隔离。写入时同步持久化到 localStorage。
 */
export const attachedPluginTabsAtom = createPersistedCwdStringListAtom(ATTACHED_PLUGIN_TABS_STORAGE_KEY);

export const HIDDEN_ACTIVITY_TABS_STORAGE_KEY = "vetta-activity-hidden-tabs";

/**
 * 用户手动隐藏（收回到"+"下拉）的活动面板 tab：会话 cwd → [tabKey]。
 * 仅记录内置/动态 tab 的 key；插件 tab 的隐藏复用 detach（见 attachedPluginTabsAtom）。
 * 文件、知识库加工历史两个 tab 禁止隐藏，永不写入此集合。
 */
export const hiddenActivityTabsAtom = createPersistedCwdStringListAtom(HIDDEN_ACTIVITY_TABS_STORAGE_KEY);

export const ACTIVITY_TAB_ORDER_STORAGE_KEY = "vetta-activity-tab-order";

/**
 * 活动面板 tab 的用户拖拽排序：会话 cwd → [tabKey...]。
 * 未出现在此列表中的 tab（如新出现的动态/插件 tab）按自然顺序追加到末尾。
 */
export const activityTabOrderAtom = createPersistedCwdStringListAtom(ACTIVITY_TAB_ORDER_STORAGE_KEY);
