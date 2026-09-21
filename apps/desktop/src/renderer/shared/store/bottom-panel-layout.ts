/**
 * 底部面板的布局树与状态转换，纯函数。
 *
 * 面板一期就要支持分屏，所以持久化的形状直接是布局树而不是 tab 列表——先做列表再
 * 升级成树需要一次数据迁移，而树能同时表达「只有一组 tab」这种退化情况。
 *
 * 所有新 id 由调用方传入（`nanoid`/`crypto.randomUUID` 在 hook 层），使这里可以被
 * 断言精确的输出，不需要在测试里桩掉随机源。
 */

export const BOTTOM_PANEL_SCHEMA_VERSION = 1;

/** 内置为稳定字符串（`terminal`），插件为 `plugin:<pluginId>:<componentId>`。 */
export type BottomPanelComponentId = string;

export type BottomPanelSplitDirection = "row" | "column";

export interface BottomPanelTabState {
	readonly tabId: string;
	readonly componentId: BottomPanelComponentId;
	/** 组件自报的可持久化载荷（终端存 cwd 与快照 id）。 */
	readonly payload?: unknown;
}

export interface BottomPanelLeaf {
	readonly kind: "leaf";
	readonly id: string;
	readonly tabs: readonly BottomPanelTabState[];
	readonly activeTabId: string | null;
}

export interface BottomPanelGroup {
	readonly kind: "group";
	readonly id: string;
	readonly direction: BottomPanelSplitDirection;
	readonly children: readonly BottomPanelNode[];
	/** 与 `children` 等长，和为 1。 */
	readonly sizes: readonly number[];
}

export type BottomPanelNode = BottomPanelGroup | BottomPanelLeaf;

export interface BottomPanelSessionState {
	readonly schemaVersion: number;
	readonly collapsed: boolean;
	/** 面板高度占会话页可用高度的比例。 */
	readonly heightRatio: number;
	readonly root: BottomPanelNode | null;
	readonly activeLeafId: string | null;
}

export const BOTTOM_PANEL_MIN_HEIGHT_RATIO = 0.15;
export const BOTTOM_PANEL_MAX_HEIGHT_RATIO = 0.8;
export const BOTTOM_PANEL_DEFAULT_HEIGHT_RATIO = 0.35;

/** 一个分屏格子在其所属 group 内的最小占比，防止拖成 0 宽后再也抓不回来。 */
export const BOTTOM_PANEL_MIN_SPLIT_RATIO = 0.12;

/**
 * 分屏格子数上限。超限时 `split-leaf` 原样返回，由 UI 禁用按钮并给出原因——
 * 这里刻意不像活动面板那样按 LRU 淘汰：淘汰一个格子等于杀掉用户正在跑的进程，
 * 代价和「重挂一个只读面板」完全不同。
 */
export const BOTTOM_PANEL_MAX_LEAVES = 8;

export function emptyBottomPanelState(): BottomPanelSessionState {
	return {
		schemaVersion: BOTTOM_PANEL_SCHEMA_VERSION,
		collapsed: true,
		heightRatio: BOTTOM_PANEL_DEFAULT_HEIGHT_RATIO,
		root: null,
		activeLeafId: null,
	};
}

/**
 * 是否与默认状态完全一致。持久化据此删键，避免 Record 里留下一堆空壳。
 *
 * 判据刻意不是「有没有 tab」：「展开了但还没添加第一个 tab」也是用户改过的状态，
 * 按「空」丢掉会让点开面板这一步存不下来，表现为按钮点了没反应。
 */
export function isDefaultBottomPanelState(state: BottomPanelSessionState): boolean {
	return (
		state.root === null &&
		state.collapsed &&
		state.heightRatio === BOTTOM_PANEL_DEFAULT_HEIGHT_RATIO &&
		state.activeLeafId === null
	);
}

export type BottomPanelSplitContent =
	| { readonly kind: "move-tab"; readonly tabId: string }
	| { readonly kind: "new-tab"; readonly tabId: string; readonly componentId: BottomPanelComponentId };

export type BottomPanelAction =
	| {
			readonly type: "open-tab";
			readonly tabId: string;
			readonly componentId: BottomPanelComponentId;
			readonly newLeafId: string;
			/** 省略则落在当前激活的格子里。 */
			readonly leafId?: string;
	  }
	| { readonly type: "close-tab"; readonly tabId: string }
	| { readonly type: "activate-tab"; readonly tabId: string }
	| { readonly type: "focus-leaf"; readonly leafId: string }
	| {
			readonly type: "move-tab";
			readonly tabId: string;
			readonly targetLeafId: string;
			readonly targetIndex: number;
	  }
	| {
			readonly type: "split-leaf";
			readonly leafId: string;
			readonly direction: BottomPanelSplitDirection;
			readonly newLeafId: string;
			readonly newGroupId: string;
			readonly content: BottomPanelSplitContent;
	  }
	| {
			readonly type: "resize-group";
			readonly groupId: string;
			/** 被拖动的分隔条左/上侧格子的下标。 */
			readonly index: number;
			readonly delta: number;
	  }
	| { readonly type: "set-height-ratio"; readonly ratio: number }
	| { readonly type: "set-collapsed"; readonly collapsed: boolean }
	| { readonly type: "set-payload"; readonly tabId: string; readonly payload: unknown }
	| { readonly type: "prune"; readonly knownComponentIds: readonly BottomPanelComponentId[] };

// ─── 树操作 ────────────────────────────────────────────────────────

export function collectBottomPanelLeaves(node: BottomPanelNode | null): BottomPanelLeaf[] {
	if (!node) return [];
	if (node.kind === "leaf") return [node];
	return node.children.flatMap(collectBottomPanelLeaves);
}

export function findBottomPanelTab(
	node: BottomPanelNode | null,
	tabId: string,
): { leaf: BottomPanelLeaf; tab: BottomPanelTabState } | null {
	for (const leaf of collectBottomPanelLeaves(node)) {
		const tab = leaf.tabs.find((entry) => entry.tabId === tabId);
		if (tab) return { leaf, tab };
	}
	return null;
}

function normalizeSizes(sizes: readonly number[]): number[] {
	const positive = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
	const total = positive.reduce((sum, size) => sum + size, 0);
	if (total <= 0) return positive.map(() => 1 / Math.max(1, positive.length));
	return positive.map((size) => size / total);
}

/** children 变化后重建 group：单子塌缩、零子消失，比例按剩余项等比放大。 */
function rebuildGroup(group: BottomPanelGroup, children: (BottomPanelNode | null)[]): BottomPanelNode | null {
	const kept: BottomPanelNode[] = [];
	const keptSizes: number[] = [];
	children.forEach((child, index) => {
		if (!child) return;
		kept.push(child);
		keptSizes.push(group.sizes[index] ?? 0);
	});
	if (kept.length === 0) return null;
	if (kept.length === 1) return kept[0] ?? null;
	return { ...group, children: kept, sizes: normalizeSizes(keptSizes) };
}

function removeTabFromNode(
	node: BottomPanelNode,
	tabId: string,
): { node: BottomPanelNode | null; removed: BottomPanelTabState | null } {
	if (node.kind === "leaf") {
		const index = node.tabs.findIndex((tab) => tab.tabId === tabId);
		if (index === -1) return { node, removed: null };
		const removed = node.tabs[index] ?? null;
		const tabs = node.tabs.filter((tab) => tab.tabId !== tabId);
		if (tabs.length === 0) return { node: null, removed };
		const activeTabId =
			node.activeTabId === tabId ? (tabs[Math.min(index, tabs.length - 1)]?.tabId ?? null) : node.activeTabId;
		return { node: { ...node, tabs, activeTabId }, removed };
	}

	let removed: BottomPanelTabState | null = null;
	const children = node.children.map((child) => {
		if (removed) return child;
		const result = removeTabFromNode(child, tabId);
		removed = result.removed;
		return result.node;
	});
	if (!removed) return { node, removed: null };
	return { node: rebuildGroup(node, children), removed };
}

function mapLeaf(
	node: BottomPanelNode,
	leafId: string,
	transform: (leaf: BottomPanelLeaf) => BottomPanelNode,
): BottomPanelNode {
	if (node.kind === "leaf") return node.id === leafId ? transform(node) : node;
	const children = node.children.map((child) => mapLeaf(child, leafId, transform));
	const changed = children.some((child, index) => child !== node.children[index]);
	return changed ? { ...node, children } : node;
}

function insertTabIntoLeaf(
	node: BottomPanelNode,
	leafId: string,
	tab: BottomPanelTabState,
	index: number,
): BottomPanelNode {
	return mapLeaf(node, leafId, (leaf) => {
		const tabs = [...leaf.tabs];
		tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
		return { ...leaf, tabs, activeTabId: tab.tabId };
	});
}

function findParentGroup(node: BottomPanelNode, childId: string): BottomPanelGroup | null {
	if (node.kind === "leaf") return null;
	if (node.children.some((child) => child.id === childId)) return node;
	for (const child of node.children) {
		const found = findParentGroup(child, childId);
		if (found) return found;
	}
	return null;
}

function replaceNode(node: BottomPanelNode, targetId: string, next: BottomPanelNode): BottomPanelNode {
	if (node.id === targetId) return next;
	if (node.kind === "leaf") return node;
	const children = node.children.map((child) => replaceNode(child, targetId, next));
	const changed = children.some((child, index) => child !== node.children[index]);
	return changed ? { ...node, children } : node;
}

/** 在已有同方向 group 里插入兄弟，而不是再套一层——否则连续分屏会把树拉得很深。 */
function insertSiblingLeaf(group: BottomPanelGroup, afterChildId: string, leaf: BottomPanelLeaf): BottomPanelGroup {
	const index = group.children.findIndex((child) => child.id === afterChildId);
	if (index === -1) return group;
	const children = [...group.children];
	children.splice(index + 1, 0, leaf);
	const sizes = [...group.sizes];
	const half = (sizes[index] ?? 1 / group.children.length) / 2;
	sizes[index] = half;
	sizes.splice(index + 1, 0, half);
	return { ...group, children, sizes: normalizeSizes(sizes) };
}

function resizeGroupSizes(sizes: readonly number[], index: number, delta: number): number[] {
	if (index < 0 || index + 1 >= sizes.length) return [...sizes];
	const left = sizes[index] ?? 0;
	const right = sizes[index + 1] ?? 0;
	const pair = left + right;
	const min = Math.min(BOTTOM_PANEL_MIN_SPLIT_RATIO, pair / 2);
	const nextLeft = Math.max(min, Math.min(pair - min, left + delta));
	const next = [...sizes];
	next[index] = nextLeft;
	next[index + 1] = pair - nextLeft;
	return next;
}

function resizeGroupById(node: BottomPanelNode, groupId: string, index: number, delta: number): BottomPanelNode {
	if (node.kind === "leaf") return node;
	if (node.id === groupId) return { ...node, sizes: resizeGroupSizes(node.sizes, index, delta) };
	const children = node.children.map((child) => resizeGroupById(child, groupId, index, delta));
	const changed = children.some((child, i) => child !== node.children[i]);
	return changed ? { ...node, children } : node;
}

function mapTabs(
	node: BottomPanelNode,
	transform: (tabs: readonly BottomPanelTabState[]) => readonly BottomPanelTabState[],
): BottomPanelNode | null {
	if (node.kind === "leaf") {
		const tabs = transform(node.tabs);
		if (tabs === node.tabs) return node;
		if (tabs.length === 0) return null;
		const activeTabId = tabs.some((tab) => tab.tabId === node.activeTabId)
			? node.activeTabId
			: (tabs[tabs.length - 1]?.tabId ?? null);
		return { ...node, tabs, activeTabId };
	}
	const children = node.children.map((child) => mapTabs(child, transform));
	const changed = children.some((child, index) => child !== node.children[index]);
	return changed ? rebuildGroup(node, children) : node;
}

function resolveActiveLeafId(root: BottomPanelNode | null, preferred: string | null): string | null {
	const leaves = collectBottomPanelLeaves(root);
	if (leaves.length === 0) return null;
	if (preferred && leaves.some((leaf) => leaf.id === preferred)) return preferred;
	return leaves[0]?.id ?? null;
}

/** UI 用它禁用分屏入口，避免用户点了没反应。 */
export function canSplitBottomPanel(state: BottomPanelSessionState): boolean {
	return collectBottomPanelLeaves(state.root).length < BOTTOM_PANEL_MAX_LEAVES;
}

export function clampBottomPanelHeightRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) return BOTTOM_PANEL_DEFAULT_HEIGHT_RATIO;
	return Math.min(BOTTOM_PANEL_MAX_HEIGHT_RATIO, Math.max(BOTTOM_PANEL_MIN_HEIGHT_RATIO, ratio));
}

// ─── reducer ──────────────────────────────────────────────────────

export function reduceBottomPanel(state: BottomPanelSessionState, action: BottomPanelAction): BottomPanelSessionState {
	switch (action.type) {
		case "open-tab": {
			const tab: BottomPanelTabState = { tabId: action.tabId, componentId: action.componentId };
			if (!state.root) {
				const leaf: BottomPanelLeaf = {
					kind: "leaf",
					id: action.newLeafId,
					tabs: [tab],
					activeTabId: tab.tabId,
				};
				return { ...state, collapsed: false, root: leaf, activeLeafId: leaf.id };
			}
			const targetLeafId = resolveActiveLeafId(state.root, action.leafId ?? state.activeLeafId);
			if (!targetLeafId) return state;
			const root = insertTabIntoLeaf(state.root, targetLeafId, tab, Number.MAX_SAFE_INTEGER);
			return { ...state, collapsed: false, root, activeLeafId: targetLeafId };
		}

		case "close-tab": {
			if (!state.root) return state;
			const { node, removed } = removeTabFromNode(state.root, action.tabId);
			if (!removed) return state;
			return { ...state, root: node, activeLeafId: resolveActiveLeafId(node, state.activeLeafId) };
		}

		case "activate-tab": {
			if (!state.root) return state;
			const found = findBottomPanelTab(state.root, action.tabId);
			if (!found) return state;
			const root = mapLeaf(state.root, found.leaf.id, (leaf) => ({ ...leaf, activeTabId: action.tabId }));
			return { ...state, root, activeLeafId: found.leaf.id };
		}

		case "focus-leaf": {
			const activeLeafId = resolveActiveLeafId(state.root, action.leafId);
			return activeLeafId === state.activeLeafId ? state : { ...state, activeLeafId };
		}

		case "move-tab": {
			if (!state.root) return state;
			const source = findBottomPanelTab(state.root, action.tabId);
			if (!source) return state;
			// 同格子内换序：先摘再插会让目标下标漂移一位，所以直接重排这一格。
			if (source.leaf.id === action.targetLeafId) {
				const root = mapLeaf(state.root, source.leaf.id, (leaf) => {
					const rest = leaf.tabs.filter((tab) => tab.tabId !== action.tabId);
					const index = Math.max(0, Math.min(action.targetIndex, rest.length));
					const tabs = [...rest];
					tabs.splice(index, 0, source.tab);
					return { ...leaf, tabs, activeTabId: action.tabId };
				});
				return { ...state, root, activeLeafId: source.leaf.id };
			}
			const { node } = removeTabFromNode(state.root, action.tabId);
			if (!node) return state;
			if (!collectBottomPanelLeaves(node).some((leaf) => leaf.id === action.targetLeafId)) return state;
			const root = insertTabIntoLeaf(node, action.targetLeafId, source.tab, action.targetIndex);
			return { ...state, root, activeLeafId: action.targetLeafId };
		}

		case "split-leaf": {
			if (!state.root) return state;
			const leaves = collectBottomPanelLeaves(state.root);
			if (leaves.length >= BOTTOM_PANEL_MAX_LEAVES) return state;
			const leaf = leaves.find((entry) => entry.id === action.leafId);
			if (!leaf) return state;

			let source = state.root;
			let movedTab: BottomPanelTabState;
			if (action.content.kind === "move-tab") {
				// 只剩一个 tab 的格子拆不出去：搬走之后源格子会被回收，等于什么都没分。
				if (leaf.tabs.length < 2) return state;
				const found = findBottomPanelTab(state.root, action.content.tabId);
				if (!found || found.leaf.id !== leaf.id) return state;
				const removal = removeTabFromNode(state.root, action.content.tabId);
				if (!removal.node || !removal.removed) return state;
				source = removal.node;
				movedTab = removal.removed;
			} else {
				movedTab = { tabId: action.content.tabId, componentId: action.content.componentId };
			}

			const newLeaf: BottomPanelLeaf = {
				kind: "leaf",
				id: action.newLeafId,
				tabs: [movedTab],
				activeTabId: movedTab.tabId,
			};

			const parent = findParentGroup(source, leaf.id);
			if (parent && parent.direction === action.direction) {
				const root = replaceNode(source, parent.id, insertSiblingLeaf(parent, leaf.id, newLeaf));
				return { ...state, collapsed: false, root, activeLeafId: newLeaf.id };
			}

			const currentLeaf = collectBottomPanelLeaves(source).find((entry) => entry.id === leaf.id);
			if (!currentLeaf) return state;
			const group: BottomPanelGroup = {
				kind: "group",
				id: action.newGroupId,
				direction: action.direction,
				children: [currentLeaf, newLeaf],
				sizes: [0.5, 0.5],
			};
			const root = replaceNode(source, leaf.id, group);
			return { ...state, collapsed: false, root, activeLeafId: newLeaf.id };
		}

		case "resize-group": {
			if (!state.root) return state;
			const root = resizeGroupById(state.root, action.groupId, action.index, action.delta);
			return root === state.root ? state : { ...state, root };
		}

		case "set-height-ratio": {
			const heightRatio = clampBottomPanelHeightRatio(action.ratio);
			return heightRatio === state.heightRatio ? state : { ...state, heightRatio };
		}

		case "set-collapsed":
			return action.collapsed === state.collapsed ? state : { ...state, collapsed: action.collapsed };

		case "set-payload": {
			if (!state.root) return state;
			const root = mapTabs(state.root, (tabs) => {
				const index = tabs.findIndex((tab) => tab.tabId === action.tabId);
				if (index === -1) return tabs;
				if (tabs[index]?.payload === action.payload) return tabs;
				const next = [...tabs];
				const current = next[index];
				if (!current) return tabs;
				next[index] = { ...current, payload: action.payload };
				return next;
			});
			return root === state.root ? state : { ...state, root };
		}

		case "prune": {
			if (!state.root) return state;
			const known = new Set(action.knownComponentIds);
			const root = mapTabs(state.root, (tabs) => {
				const next = tabs.filter((tab) => known.has(tab.componentId));
				return next.length === tabs.length ? tabs : next;
			});
			if (root === state.root) return state;
			return {
				...state,
				root,
				collapsed: root === null ? true : state.collapsed,
				activeLeafId: resolveActiveLeafId(root, state.activeLeafId),
			};
		}

		default:
			return state;
	}
}
