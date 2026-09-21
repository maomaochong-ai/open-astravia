/**
 * 底部面板布局的落盘读写。
 *
 * 介质是 renderer 的 localStorage：结构本身只有 KB 级，和活动面板宽度同一量级。
 * 终端的 scrollback 快照**不在**这里——那是几百 KB 级、可丢弃的内容，走主进程的
 * ApplicationCacheService，只在 tab 的 payload 里留一个引用。
 *
 * 会话主键与输入草稿同源（`session-input-draft.ts`）：已有会话用 sessionPath，
 * 新会话页用 `new:${cwd}`，所以同一个项目下的多个会话各有自己的面板。
 */

import {
	BOTTOM_PANEL_SCHEMA_VERSION,
	type BottomPanelLeaf,
	type BottomPanelNode,
	type BottomPanelSessionState,
	type BottomPanelTabState,
	clampBottomPanelHeightRatio,
	collectBottomPanelLeaves,
	isDefaultBottomPanelState,
} from "./bottom-panel-layout";

export const BOTTOM_PANEL_STORAGE_KEY = "vetta-bottom-panel-layout";

/** 保留最近使用的会话数；超出丢最旧的，避免 Record 随会话数无限膨胀。 */
export const BOTTOM_PANEL_SESSION_LIMIT = 50;

interface PersistedFile {
	readonly version: number;
	/** 最近使用的排在最后，越界时从头丢。 */
	readonly entries: readonly [string, unknown][];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function sanitizeTab(value: unknown): BottomPanelTabState | null {
	if (!isRecord(value)) return null;
	const { tabId, componentId, payload } = value;
	if (typeof tabId !== "string" || !tabId) return null;
	if (typeof componentId !== "string" || !componentId) return null;
	return payload === undefined ? { tabId, componentId } : { tabId, componentId, payload };
}

function sanitizeNode(value: unknown): BottomPanelNode | null {
	if (!isRecord(value)) return null;
	if (value.kind === "leaf") {
		const id = value.id;
		if (typeof id !== "string" || !id) return null;
		const tabs = Array.isArray(value.tabs)
			? value.tabs.map(sanitizeTab).filter((tab): tab is BottomPanelTabState => tab !== null)
			: [];
		if (tabs.length === 0) return null;
		const activeTabId = typeof value.activeTabId === "string" ? value.activeTabId : null;
		const leaf: BottomPanelLeaf = {
			kind: "leaf",
			id,
			tabs,
			activeTabId: tabs.some((tab) => tab.tabId === activeTabId) ? activeTabId : (tabs[0]?.tabId ?? null),
		};
		return leaf;
	}
	if (value.kind === "group") {
		const id = value.id;
		if (typeof id !== "string" || !id) return null;
		const direction = value.direction === "column" ? "column" : "row";
		const rawChildren = Array.isArray(value.children) ? value.children : [];
		const rawSizes = Array.isArray(value.sizes) ? value.sizes : [];
		const children: BottomPanelNode[] = [];
		const sizes: number[] = [];
		rawChildren.forEach((child, index) => {
			const node = sanitizeNode(child);
			if (!node) return;
			children.push(node);
			const size = rawSizes[index];
			sizes.push(typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 1);
		});
		if (children.length === 0) return null;
		// 单子 group 在树里没有意义，直接塌缩，免得后续每处都要再判一次。
		if (children.length === 1) return children[0] ?? null;
		const total = sizes.reduce((sum, size) => sum + size, 0);
		return { kind: "group", id, direction, children, sizes: sizes.map((size) => size / total) };
	}
	return null;
}

/** 结构不可信时返回 null；调用方按「这个会话没有面板」处理，而不是崩在渲染里。 */
export function sanitizeBottomPanelState(value: unknown): BottomPanelSessionState | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== BOTTOM_PANEL_SCHEMA_VERSION) return null;
	const root = value.root === null || value.root === undefined ? null : sanitizeNode(value.root);
	if (!root) return null;
	const leaves = collectBottomPanelLeaves(root);
	const activeLeafId = typeof value.activeLeafId === "string" ? value.activeLeafId : null;
	return {
		schemaVersion: BOTTOM_PANEL_SCHEMA_VERSION,
		collapsed: value.collapsed !== false,
		heightRatio: clampBottomPanelHeightRatio(typeof value.heightRatio === "number" ? value.heightRatio : Number.NaN),
		root,
		activeLeafId: leaves.some((leaf) => leaf.id === activeLeafId) ? activeLeafId : (leaves[0]?.id ?? null),
	};
}

export function parseBottomPanelStates(raw: string | null): Map<string, BottomPanelSessionState> {
	const result = new Map<string, BottomPanelSessionState>();
	if (!raw) return result;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return result;
	}
	if (!isRecord(parsed)) return result;
	const file = parsed as Partial<PersistedFile>;
	if (file.version !== BOTTOM_PANEL_SCHEMA_VERSION || !Array.isArray(file.entries)) return result;
	for (const entry of file.entries) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const [key, value] = entry;
		if (typeof key !== "string" || !key) continue;
		const state = sanitizeBottomPanelState(value);
		if (state) result.set(key, state);
	}
	return result;
}

export function serializeBottomPanelStates(states: ReadonlyMap<string, BottomPanelSessionState>): string {
	const file: PersistedFile = {
		version: BOTTOM_PANEL_SCHEMA_VERSION,
		entries: [...states.entries()],
	};
	return JSON.stringify(file);
}

/**
 * 写入一个会话的状态，并把它移到 LRU 末尾。与默认状态一致时删键，避免留下空壳条目。
 */
export function touchBottomPanelState(
	states: ReadonlyMap<string, BottomPanelSessionState>,
	key: string,
	state: BottomPanelSessionState | null,
): Map<string, BottomPanelSessionState> {
	const next = new Map(states);
	next.delete(key);
	if (state && !isDefaultBottomPanelState(state)) next.set(key, state);
	while (next.size > BOTTOM_PANEL_SESSION_LIMIT) {
		const oldest = next.keys().next();
		if (oldest.done) break;
		next.delete(oldest.value);
	}
	return next;
}

/** 新会话首条消息落地真实 sessionPath 后，把 `new:${cwd}` 上的面板改挂到新主键。 */
export function renameBottomPanelStateKey(
	states: ReadonlyMap<string, BottomPanelSessionState>,
	fromKey: string,
	toKey: string,
): Map<string, BottomPanelSessionState> {
	if (fromKey === toKey) return new Map(states);
	const state = states.get(fromKey);
	const next = new Map(states);
	next.delete(fromKey);
	if (state) {
		next.delete(toKey);
		next.set(toKey, state);
	}
	return next;
}

export function readPersistedBottomPanelStates(): Map<string, BottomPanelSessionState> {
	try {
		return parseBottomPanelStates(localStorage.getItem(BOTTOM_PANEL_STORAGE_KEY));
	} catch {
		return new Map();
	}
}

export function persistBottomPanelStates(states: ReadonlyMap<string, BottomPanelSessionState>): void {
	try {
		localStorage.setItem(BOTTOM_PANEL_STORAGE_KEY, serializeBottomPanelStates(states));
	} catch {
		// ignore quota / private mode
	}
}
