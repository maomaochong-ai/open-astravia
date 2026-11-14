import { useSidebarState } from "@shared/app-shell/sidebar-state";
import type { TabBarItem } from "@shared/components/ui/tab-bar";
import { useNarrowScreen, useWindowWidth } from "@shared/hooks/useNarrowScreen";
import { type ActivityTabKey, useProjectProfile } from "@shared/lib/project-profile";
import { withTabVisibility } from "@shared/lib/tab-visibility";
import {
	ACTIVITY_PANEL_MIN_CHAT_AREA,
	ACTIVITY_PANEL_MIN_WIDTH,
	activityPanelFocusAtom,
	activityPanelMaxWidth,
	activityPanelOpenAtom,
	activityPanelResizingAtom,
	activityPanelTabByProjectAtom,
	activityPanelWidthAtom,
	activityTabOrderAtom,
	attachedPluginTabsAtom,
	type FloatingActivityTabPlacement,
	hiddenActivityTabsAtom,
	setActivityPanelSidebarReserveAtom,
	syncActivityPanelPreviewAvailabilityAtom,
	syncActivityPanelWidthToWindowAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityPanelActions, ActivityPanelModel } from "../components/activity-panel/types";
import { resolveActivityTabs, tabAttachKey } from "../registry/resolve-activity-tabs";
import type { ActivityTabDefinition, ActivityTabId, ActivityTabMeta, ResolvedActivityTab } from "../registry/types";
import { mergeDockedTabOrder } from "../services/floating-activity-tab";
import { useActivityTabResidency } from "./useActivityTabResidency";
import { useFloatingActivityTabs } from "./useFloatingActivityTabs";

const NON_HIDEABLE_TABS = new Set<string>(["file", "knowledge-history"]);
const EMPTY_FLOATING_TABS: readonly FloatingActivityTabPlacement[] = [];

function toTabBarItem(tab: ResolvedActivityTab): TabBarItem<ActivityTabKey> {
	return {
		key: tab.id as ActivityTabKey,
		label: tab.label,
		icon: tab.icon,
		badge: tab.badge,
		removable: tab.removable,
	};
}

export interface UseActivityPanelModelInput {
	definitions: readonly ActivityTabDefinition[];
	metaById: ReadonlyMap<ActivityTabId, ActivityTabMeta | null>;
	knowledgeHistory?: boolean;
	/** 已由外层解析的 cwd（与 Context 一致）。 */
	cwd: string | null;
	workspaceId: string;
}

export function useActivityPanelModel({
	cwd,
	workspaceId,
	definitions,
	metaById,
	knowledgeHistory = false,
}: UseActivityPanelModelInput): { actions: ActivityPanelActions; model: ActivityPanelModel } {
	const [isOpen, setOpen] = useAtom(activityPanelOpenAtom);
	const narrow = useNarrowScreen();
	const [attachedPluginTabsMap, setAttachedPluginTabsMap] = useAtom(attachedPluginTabsAtom);
	const [width, setWidth] = useAtom(activityPanelWidthAtom);
	const [isResizing, setIsResizing] = useAtom(activityPanelResizingAtom);
	const syncPreviewAvailability = useSetAtom(syncActivityPanelPreviewAvailabilityAtom);
	const syncWidthToWindow = useSetAtom(syncActivityPanelWidthToWindowAtom);
	const setSidebarReserve = useSetAtom(setActivityPanelSidebarReserveAtom);
	const [overflowKeys, setOverflowKeys] = useState<ActivityTabKey[]>([]);
	const [tabByProject, setTabByProject] = useAtom(activityPanelTabByProjectAtom);
	const windowWidth = useWindowWidth();
	const sidebar = useSidebarState();
	// 铺满时侧栏与全局页头整块让位，占位必须归 0：否则面板上限会被一条并不存在的左栏扣掉。
	const activityFocus = useAtomValue(activityPanelFocusAtom);
	const sidebarReserve = activityFocus ? 0 : sidebar.width;
	const maxWidth = activityPanelMaxWidth(windowWidth, sidebarReserve);
	/**
	 * 面板何时不再占内容行、改为从底部抽屉滑出。
	 *
	 * 侧栏常驻后，一列面板必须同时容下侧栏占位、面板最小宽与聊天区最小宽；窗口放不下时
	 * 继续占列会把聊天区压成一条窄条，输入栏直接挤变形。改走抽屉后聊天区宽度不变，
	 * 侧栏也不用因此让位。用户手动收起侧栏时占位变 0，阈值随之回落；铺满时面板本来就
	 * 占满整行，不能又把它降级成抽屉（否则铺满按钮只会剩下图标变化）。
	 */
	const panelSheetThreshold = sidebarReserve + ACTIVITY_PANEL_MIN_WIDTH + ACTIVITY_PANEL_MIN_CHAT_AREA;
	const panelAsSheet = !activityFocus && (narrow || windowWidth < panelSheetThreshold);
	const liveWidthRef = useRef(width);
	const { profile } = useProjectProfile(cwd);
	const mainTabListRef = useRef<HTMLDivElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const tabVisibilityRecords = useMemo(
		() => attachedPluginTabsMap.get(workspaceId) ?? [],
		[attachedPluginTabsMap, workspaceId],
	);
	const [hiddenTabsMap, setHiddenTabsMap] = useAtom(hiddenActivityTabsAtom);
	const [tabOrderMap, setTabOrderMap] = useAtom(activityTabOrderAtom);
	const hiddenKeys = useMemo(() => hiddenTabsMap.get(workspaceId) ?? [], [workspaceId, hiddenTabsMap]);
	const tabOrder = useMemo(() => tabOrderMap.get(workspaceId) ?? [], [workspaceId, tabOrderMap]);

	const resolved = useMemo(
		() =>
			resolveActivityTabs({
				definitions,
				metaById,
				tabVisibilityRecords,
				hiddenKeys,
				tabOrder,
			}),
		[definitions, metaById, tabVisibilityRecords, hiddenKeys, tabOrder],
	);

	const tabItems = useMemo(() => resolved.onBar.map(toTabBarItem), [resolved.onBar]);
	const restorableTabs = useMemo(
		() =>
			resolved.restorable.map((item) => ({
				key: item.id,
				label: item.label,
				icon: item.icon,
			})),
		[resolved.restorable],
	);
	const availableTabs = useMemo(
		() =>
			resolved.available.map((item) => ({
				key: item.id,
				label: item.label,
				icon: item.icon,
				subtitle: item.pluginName,
			})),
		[resolved.available],
	);

	const definitionById = useMemo(() => {
		const map = new Map<string, ActivityTabDefinition>();
		for (const def of definitions) map.set(def.id, def);
		return map;
	}, [definitions]);
	const onTabChange = useCallback(
		(next: ActivityTabKey) => {
			setTabByProject((previous) => {
				const map = new Map(previous);
				map.set(workspaceId, next);
				return map;
			});
		},
		[workspaceId, setTabByProject],
	);
	const onTabOrderChange = useCallback(
		(keys: ActivityTabKey[]) => {
			const next = new Map(tabOrderMap);
			next.set(workspaceId, keys);
			setTabOrderMap(next);
		},
		[workspaceId, setTabOrderMap, tabOrderMap],
	);
	const allTabKeys = useMemo(() => tabItems.map((item) => item.key), [tabItems]);
	const floating = useFloatingActivityTabs({
		allTabKeys,
		mainTabListRef,
		onActiveTabChange: onTabChange,
		onTabOrderChange,
		panelRef,
		panelWidth: width,
		scopeKey: workspaceId,
	});
	const floatingKeys = useMemo(
		() => (panelAsSheet ? new Set<ActivityTabKey>() : floating.model.floatingKeys),
		[panelAsSheet, floating.model.floatingKeys],
	);
	const dockedTabItems = useMemo(
		() => tabItems.filter((item) => !floatingKeys.has(item.key)),
		[tabItems, floatingKeys],
	);

	const onResizeStart = useCallback(() => {
		liveWidthRef.current = width;
		setIsResizing(true);
	}, [setIsResizing, width]);
	const onResize = useCallback(
		(liveWidth: number) => {
			liveWidthRef.current = liveWidth;
			syncPreviewAvailability(liveWidth);
		},
		[syncPreviewAvailability],
	);
	const onResizeEnd = useCallback(
		(finalWidth: number) => {
			liveWidthRef.current = finalWidth;
			setWidth(finalWidth);
			setIsResizing(false);
		},
		[setIsResizing, setWidth],
	);
	const onClose = useCallback(() => setOpen(false), [setOpen]);
	useEffect(() => () => setIsResizing(false), [setIsResizing]);

	// 侧栏可见性（或铺满状态）变化时把占位宽度写进宽度原子：面板上限要扣除它，侧栏本身不动。
	useEffect(() => {
		setSidebarReserve(sidebarReserve);
	}, [setSidebarReserve, sidebarReserve]);

	// 窗口尺寸变化时按宽度意图重解析：拉满态跟着窗口一起变宽，固定像素则夹紧/回弹。
	useEffect(() => {
		syncWidthToWindow(windowWidth);
	}, [syncWidthToWindow, windowWidth]);

	/**
	 * 打开面板时按**当下**的窗口宽度再解析一次。
	 *
	 * 像素宽度是在写入那一刻用 window.innerWidth 算出来的，而上面那次同步只在面板挂载
	 * 期间跑。面板关着时窗口若变过尺寸（或宽度意图是「拉满」而上次解析用的是更窄的窗口），
	 * 重新打开就会沿用过期宽度：面板比该占的位置窄，右侧露出一条空白，直到用户拖一下分隔条
	 * 才恢复。这里直接读 window.innerWidth 而不是 windowWidth——后者本身可能就是那个过期值。
	 * 宽度没变时 atom 内部会跳过写入，因此重复触发无代价。
	 */
	useEffect(() => {
		if (!isOpen) return;
		syncWidthToWindow(window.innerWidth);
	}, [isOpen, syncWidthToWindow]);

	const activeTab = useMemo<ActivityTabKey>(() => {
		if (knowledgeHistory && dockedTabItems.some((item) => item.key === "knowledge-history")) {
			return "knowledge-history";
		}
		{
			const remembered = tabByProject.get(workspaceId);
			if (remembered && dockedTabItems.some((item) => item.key === remembered)) return remembered;
			// Keep plugin tab sticky while contributions briefly disappear (reload / hot reload).
			// Falling back to "file" mounts FileTabContent and its unmount cleanup can reset width.
			if (remembered?.startsWith("plugin:") && !tabItems.some((item) => item.key === remembered)) {
				return remembered;
			}
		}
		const fallback = profile?.defaultActivityTab ?? "file";
		if (dockedTabItems.some((item) => item.key === fallback)) return fallback;
		return dockedTabItems[0]?.key ?? fallback;
	}, [knowledgeHistory, workspaceId, tabByProject, profile, dockedTabItems, tabItems]);
	useEffect(() => {
		console.debug(
			`[activity-tab-debug] resolved ${JSON.stringify({
				cwd,
				workspaceId,
				panelOpen: isOpen,
				remembered: tabByProject.get(workspaceId) ?? null,
				activeTab,
				visibilityRecords: tabVisibilityRecords,
				hiddenKeys,
				tabOrder,
				definitions: definitions.map((definition) => ({
					id: definition.id,
					source: definition.source,
					pluginId: definition.pluginId ?? null,
					initiallyVisible: definition.initiallyVisible ?? true,
					metaAvailable: metaById.get(definition.id) != null,
				})),
				candidates: resolved.candidates.map((tab) => tab.id),
				onBar: resolved.onBar.map((tab) => tab.id),
				available: resolved.available.map((tab) => tab.id),
				docked: dockedTabItems.map((tab) => tab.key),
			})}`,
		);
	}, [
		activeTab,
		cwd,
		workspaceId,
		definitions,
		dockedTabItems,
		hiddenKeys,
		isOpen,
		metaById,
		resolved.available,
		resolved.candidates,
		resolved.onBar,
		tabByProject,
		tabOrder,
		tabVisibilityRecords,
	]);
	// 程序切到某 tab 时若它在 hidden 列表，自动恢复（与旧行为一致）。
	useEffect(() => {
		const remembered = tabByProject.get(workspaceId);
		if (!remembered || !hiddenKeys.includes(remembered)) return;
		if (!resolved.candidates.some((item) => item.id === remembered)) return;
		const next = new Map(hiddenTabsMap);
		next.set(
			workspaceId,
			(next.get(workspaceId) ?? []).filter((key) => key !== remembered),
		);
		setHiddenTabsMap(next);
	}, [workspaceId, tabByProject, hiddenKeys, resolved.candidates, hiddenTabsMap, setHiddenTabsMap]);

	const onTabDragStart = useCallback<ActivityPanelActions["onTabDragStart"]>(
		(event) => {
			floating.actions.onDockedTabDragStart(event);
			onTabChange(event.key);
		},
		[onTabChange, floating.actions.onDockedTabDragStart],
	);

	const mountedTabs = useActivityTabResidency({
		activeTab,
		candidates: resolved.candidates,
		floatingKeys: floating.model.floatingKeys,
		scopeKey: workspaceId,
		warmEligibleTabs: resolved.onBar,
	});

	/**
	 * 批量关闭：单个和批量走同一条路径，避免逐次调用时基于同一份快照覆写 hidden 列表。
	 */
	const closeTabs = useCallback(
		(keys: readonly ActivityTabKey[]) => {
			const targets = keys.filter((key) => {
				if (NON_HIDEABLE_TABS.has(key)) return false;
				const def = definitionById.get(key);
				return !(def && def.removable === false);
			});
			if (targets.length === 0) return;
			const targetSet = new Set<ActivityTabKey>(targets);
			for (const key of targets) floating.actions.clearFloatingTab(key);

			// 插件 tab：写显式下栏，回到「+」可添加池（不进 hidden 列表）。
			let nextAttached = attachedPluginTabsMap;
			for (const key of targets) {
				if (!key.startsWith("plugin:")) continue;
				const attachKey = key.slice("plugin:".length);
				const updated = withTabVisibility(nextAttached, workspaceId, attachKey, false);
				if (updated) nextAttached = updated;
			}
			if (nextAttached !== attachedPluginTabsMap) setAttachedPluginTabsMap(nextAttached);

			const nativeKeys = targets.filter((key) => !key.startsWith("plugin:"));
			if (nativeKeys.length > 0) {
				const next = new Map(hiddenTabsMap);
				const current = next.get(workspaceId) ?? [];
				const merged = [...current];
				for (const key of nativeKeys) if (!merged.includes(key)) merged.push(key);
				next.set(workspaceId, merged);
				setHiddenTabsMap(next);
			}

			if (targetSet.has(activeTab)) {
				onTabChange(dockedTabItems.find((item) => !targetSet.has(item.key))?.key ?? "file");
			}
		},
		[
			workspaceId,
			definitionById,
			attachedPluginTabsMap,
			setAttachedPluginTabsMap,
			hiddenTabsMap,
			setHiddenTabsMap,
			activeTab,
			dockedTabItems,
			onTabChange,
			floating.actions.clearFloatingTab,
		],
	);
	const onRemoveTab = useCallback((key: ActivityTabKey) => closeTabs([key]), [closeTabs]);
	const onCloseTabs = closeTabs;
	const onRestoreTab = useCallback(
		(key: string) => {
			const next = new Map(hiddenTabsMap);
			next.set(
				workspaceId,
				(next.get(workspaceId) ?? []).filter((hiddenKey) => hiddenKey !== key),
			);
			setHiddenTabsMap(next);
			onTabChange(key as ActivityTabKey);
		},
		[workspaceId, hiddenTabsMap, setHiddenTabsMap, onTabChange],
	);
	/**
	 * 从可添加池把 tab 挂上栏并切过去（与 openActivityTab 同语义，不强制改宽度）。
	 * 内置（如浏览器）与插件共用同一套显式可见性记录，只是 attach key 不同。
	 */
	const onAttachTab = useCallback(
		(key: string) => {
			const def = definitionById.get(key);
			if (!def) return;
			const nextAttached = withTabVisibility(attachedPluginTabsMap, workspaceId, tabAttachKey(def), true);
			if (nextAttached) setAttachedPluginTabsMap(nextAttached);
			onTabChange(key as ActivityTabKey);
			setOpen(true);
		},
		[workspaceId, definitionById, attachedPluginTabsMap, setAttachedPluginTabsMap, onTabChange, setOpen],
	);
	const onReorderTabs = useCallback(
		(keys: ActivityTabKey[]) => {
			const merged = mergeDockedTabOrder(allTabKeys, floatingKeys, keys);
			onTabOrderChange(merged);
		},
		[allTabKeys, floatingKeys, onTabOrderChange],
	);
	const overflowTabs = useMemo(
		() =>
			tabItems
				.filter((item) => overflowKeys.includes(item.key))
				.map((item) => ({ key: item.key, label: item.label, icon: item.icon })),
		[tabItems, overflowKeys],
	);
	const showTabPicker =
		!knowledgeHistory &&
		cwd !== null &&
		(restorableTabs.length > 0 || overflowTabs.length > 0 || availableTabs.length > 0);

	const actions = useMemo<ActivityPanelActions>(
		() => ({
			onAttachTab,
			onClose,
			onCloseTabs,
			onFloatingResize: floating.actions.onFloatingResize,
			onFloatingResizeEnd: floating.actions.onFloatingResizeEnd,
			onFloatingTabDragEnd: floating.actions.onFloatingTabDragEnd,
			onFloatingTabDragMove: floating.actions.onFloatingTabDragMove,
			onFloatingTabDragStart: floating.actions.onFloatingTabDragStart,
			onFloatingTabFocus: floating.actions.onFloatingTabFocus,
			onOverflowChange: setOverflowKeys,
			onRemoveTab,
			onReorderTabs,
			onResizeStart,
			onResize,
			onResizeEnd,
			onRestoreTab,
			onTabChange,
			onTabDragEnd: floating.actions.onDockedTabDragEnd,
			onTabDragMove: floating.actions.onDockedTabDragMove,
			onTabDragStart,
		}),
		[
			onAttachTab,
			onClose,
			floating.actions.onDockedTabDragEnd,
			floating.actions.onDockedTabDragMove,
			floating.actions.onFloatingResize,
			floating.actions.onFloatingResizeEnd,
			floating.actions.onFloatingTabDragEnd,
			floating.actions.onFloatingTabDragMove,
			floating.actions.onFloatingTabDragStart,
			floating.actions.onFloatingTabFocus,
			onRemoveTab,
			onCloseTabs,
			onReorderTabs,
			onResizeStart,
			onResize,
			onResizeEnd,
			onRestoreTab,
			onTabChange,
			onTabDragStart,
		],
	);
	return {
		actions,
		model: {
			activeTab,
			availableTabs,
			bottomSheet: panelAsSheet && isOpen,
			cwd,
			workspaceId,
			dockPreviewBounds: panelAsSheet ? null : floating.model.dockPreviewBounds,
			floatingTabs: panelAsSheet ? EMPTY_FLOATING_TABS : floating.model.floatingTabs,
			isOpen,
			isResizing,
			knowledgeHistory,
			maxWidth,
			mainTabListRef,
			minWidth: ACTIVITY_PANEL_MIN_WIDTH,
			mountedTabs,
			narrowSheet: panelAsSheet,
			overflowTabs,
			panelRef,
			restorableTabs,
			showTabPicker,
			tabItems: dockedTabItems,
			width,
		},
	};
}
