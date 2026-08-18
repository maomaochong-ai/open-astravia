import { withPluginTabVisibility } from "@domains/plugins/runtime/attached-tabs";
import type { TabBarItem } from "@shared/components/ui/tab-bar";
import { useNarrowScreen, useWindowWidth } from "@shared/hooks/useNarrowScreen";
import { type ActivityTabKey, useProjectProfile } from "@shared/lib/project-profile";
import {
	ACTIVITY_PANEL_MIN_CHAT_AREA,
	ACTIVITY_PANEL_MIN_WIDTH,
	activityPanelMaxWidth,
	activityPanelOpenAtom,
	activityPanelResizingAtom,
	activityPanelTabByProjectAtom,
	activityPanelWidthAtom,
	activityPanelWidthModeAtom,
	activityTabOrderAtom,
	attachedPluginTabsAtom,
	hiddenActivityTabsAtom,
	persistActivityPanelWidthAtom,
	resolveActivityPanelWidth,
	setTransientActivityPanelWidthAtom,
	sidebarCollapsedAtom,
	sidebarWidthAtom,
	syncActivityPanelWidthToWindowAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityPanelActions, ActivityPanelModel, ActivityPanelProps } from "../components/activity-panel/types";
import { resolveActivityTabs } from "../registry/resolve-activity-tabs";
import type { ActivityTabDefinition, ActivityTabId, ActivityTabMeta, ResolvedActivityTab } from "../registry/types";
import { mergeDockedTabOrder } from "../services/floating-activity-tab";
import { useActivityTabResidency } from "./useActivityTabResidency";
import { useFloatingActivityTabs } from "./useFloatingActivityTabs";

const NON_HIDEABLE_TABS = new Set<string>(["file", "knowledge-history"]);

function toTabBarItem(tab: ResolvedActivityTab): TabBarItem<ActivityTabKey> {
	return {
		key: tab.id as ActivityTabKey,
		label: tab.label,
		icon: tab.icon,
		badge: tab.badge,
		removable: tab.removable,
	};
}

export interface UseActivityPanelModelInput extends ActivityPanelProps {
	definitions: readonly ActivityTabDefinition[];
	metaById: ReadonlyMap<ActivityTabId, ActivityTabMeta | null>;
	/** 已由外层解析的 cwd（与 Context 一致）。 */
	cwd: string | null;
}

export function useActivityPanelModel({
	cwd,
	definitions,
	metaById,
	knowledgeHistory = false,
}: UseActivityPanelModelInput): { actions: ActivityPanelActions; model: ActivityPanelModel } {
	const [isOpen, setOpen] = useAtom(activityPanelOpenAtom);
	const narrow = useNarrowScreen();
	const [attachedPluginTabsMap, setAttachedPluginTabsMap] = useAtom(attachedPluginTabsAtom);
	const [width, setWidth] = useAtom(activityPanelWidthAtom);
	const [isResizing, setIsResizing] = useAtom(activityPanelResizingAtom);
	const setTransientWidth = useSetAtom(setTransientActivityPanelWidthAtom);
	const persistWidth = useSetAtom(persistActivityPanelWidthAtom);
	const syncWidthToWindow = useSetAtom(syncActivityPanelWidthToWindowAtom);
	const widthMode = useAtomValue(activityPanelWidthModeAtom);
	const [overflowKeys, setOverflowKeys] = useState<ActivityTabKey[]>([]);
	const [tabByProject, setTabByProject] = useAtom(activityPanelTabByProjectAtom);
	const windowWidth = useWindowWidth();
	const sidebarWidth = useAtomValue(sidebarWidthAtom);
	const maxWidth = activityPanelMaxWidth(windowWidth);
	const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
	const widthCollapsedSidebarRef = useRef<boolean | null>(null);
	const prevSidebarCollapsedRef = useRef(sidebarCollapsed);
	const { profile } = useProjectProfile(cwd);
	const mainTabListRef = useRef<HTMLDivElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const tabVisibilityRecords = useMemo(
		() => (cwd ? (attachedPluginTabsMap.get(cwd) ?? []) : []),
		[attachedPluginTabsMap, cwd],
	);
	const [hiddenTabsMap, setHiddenTabsMap] = useAtom(hiddenActivityTabsAtom);
	const [tabOrderMap, setTabOrderMap] = useAtom(activityTabOrderAtom);
	const hiddenKeys = useMemo(() => (cwd ? (hiddenTabsMap.get(cwd) ?? []) : []), [cwd, hiddenTabsMap]);
	const tabOrder = useMemo(() => (cwd ? (tabOrderMap.get(cwd) ?? []) : []), [cwd, tabOrderMap]);

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
	const availablePluginTabs = useMemo(
		() =>
			resolved.availablePlugins.map((item) => ({
				key: item.id,
				label: item.label,
				icon: item.icon,
				subtitle: item.pluginName,
			})),
		[resolved.availablePlugins],
	);

	const definitionById = useMemo(() => {
		const map = new Map<string, ActivityTabDefinition>();
		for (const def of definitions) map.set(def.id, def);
		return map;
	}, [definitions]);
	const onTabChange = useCallback(
		(next: ActivityTabKey) => {
			if (!cwd) return;
			setTabByProject((previous) => {
				const map = new Map(previous);
				map.set(cwd, next);
				return map;
			});
		},
		[cwd, setTabByProject],
	);
	const onTabOrderChange = useCallback(
		(keys: ActivityTabKey[]) => {
			if (!cwd) return;
			const next = new Map(tabOrderMap);
			next.set(cwd, keys);
			setTabOrderMap(next);
		},
		[cwd, setTabOrderMap, tabOrderMap],
	);
	const allTabKeys = useMemo(() => tabItems.map((item) => item.key), [tabItems]);
	const floating = useFloatingActivityTabs({
		allTabKeys,
		mainTabListRef,
		onActiveTabChange: onTabChange,
		onTabOrderChange,
		panelRef,
		panelWidth: width,
		scopeKey: cwd,
	});
	const floatingKeys = useMemo(
		() => (narrow ? new Set<ActivityTabKey>() : floating.model.floatingKeys),
		[narrow, floating.model.floatingKeys],
	);
	const dockedTabItems = useMemo(
		() => tabItems.filter((item) => !floatingKeys.has(item.key)),
		[tabItems, floatingKeys],
	);

	const onResize = useCallback(
		(delta: number) => {
			setIsResizing(true);
			setTransientWidth((currentWidth) =>
				Math.min(maxWidth, Math.max(ACTIVITY_PANEL_MIN_WIDTH, currentWidth + delta)),
			);
		},
		[maxWidth, setIsResizing, setTransientWidth],
	);
	const onResizeEnd = useCallback(() => {
		setIsResizing(false);
		persistWidth();
	}, [persistWidth, setIsResizing]);
	const onClose = useCallback(() => setOpen(false), [setOpen]);
	useEffect(() => () => setIsResizing(false), [setIsResizing]);

	// 窗口尺寸变化时按宽度意图重解析：拉满态跟着窗口一起变宽，固定像素则夹紧/回弹。
	useEffect(() => {
		syncWidthToWindow(windowWidth);
	}, [windowWidth, syncWidthToWindow]);

	/**
	 * 当前窗口宽度下面板**应有**的宽度。侧边栏联动必须用它而不是 `width`：`width` 由上面的
	 * effect 异步写回，窗口刚变宽的那一轮里它还是旧值，用旧宽度会误判成「面板不再过宽」而
	 * 展开侧边栏，下一轮又把面板压回 openLimit——拉满态会因此被打回固定宽度。
	 */
	const effectiveWidth = resolveActivityPanelWidth(widthMode, windowWidth);

	useEffect(() => {
		const openLimit = Math.max(ACTIVITY_PANEL_MIN_WIDTH, windowWidth - sidebarWidth - ACTIVITY_PANEL_MIN_CHAT_AREA);
		const collapsedChanged = prevSidebarCollapsedRef.current !== sidebarCollapsed;
		prevSidebarCollapsedRef.current = sidebarCollapsed;
		if (collapsedChanged && !sidebarCollapsed && isOpen && effectiveWidth > openLimit) {
			widthCollapsedSidebarRef.current = null;
			setWidth(openLimit);
			return;
		}

		const shouldCollapse = isOpen && effectiveWidth > openLimit;
		if (shouldCollapse) {
			if (widthCollapsedSidebarRef.current === null) {
				widthCollapsedSidebarRef.current = sidebarCollapsed;
				setSidebarCollapsed(true);
			}
		} else if (widthCollapsedSidebarRef.current !== null) {
			const restore = widthCollapsedSidebarRef.current;
			widthCollapsedSidebarRef.current = null;
			setSidebarCollapsed(restore);
		}
	}, [effectiveWidth, windowWidth, sidebarWidth, isOpen, sidebarCollapsed, setSidebarCollapsed, setWidth]);

	const activeTab = useMemo<ActivityTabKey>(() => {
		if (knowledgeHistory && dockedTabItems.some((item) => item.key === "knowledge-history")) {
			return "knowledge-history";
		}
		if (cwd) {
			const remembered = tabByProject.get(cwd);
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
	}, [knowledgeHistory, cwd, tabByProject, profile, dockedTabItems, tabItems]);
	// 程序切到某 tab 时若它在 hidden 列表，自动恢复（与旧行为一致）。
	useEffect(() => {
		if (!cwd) return;
		const remembered = tabByProject.get(cwd);
		if (!remembered || !hiddenKeys.includes(remembered)) return;
		if (!resolved.candidates.some((item) => item.id === remembered)) return;
		const next = new Map(hiddenTabsMap);
		next.set(
			cwd,
			(next.get(cwd) ?? []).filter((key) => key !== remembered),
		);
		setHiddenTabsMap(next);
	}, [cwd, tabByProject, hiddenKeys, resolved.candidates, hiddenTabsMap, setHiddenTabsMap]);

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
		scopeKey: cwd,
		warmEligibleTabs: resolved.onBar,
	});

	const onRemoveTab = useCallback(
		(key: ActivityTabKey) => {
			if (!cwd || NON_HIDEABLE_TABS.has(key)) return;
			const def = definitionById.get(key);
			if (def && def.removable === false) return;
			floating.actions.clearFloatingTab(key);

			// 插件 tab：写显式下栏，回到「+」可添加池（不进 hidden 列表）。
			if (key.startsWith("plugin:")) {
				const attachKey = key.slice("plugin:".length);
				const nextAttached = withPluginTabVisibility(attachedPluginTabsMap, cwd, attachKey, false);
				if (nextAttached) setAttachedPluginTabsMap(nextAttached);
				if (activeTab === key) {
					onTabChange(dockedTabItems.find((item) => item.key !== key)?.key ?? "file");
				}
				return;
			}
			const next = new Map(hiddenTabsMap);
			const current = next.get(cwd) ?? [];
			if (!current.includes(key)) next.set(cwd, [...current, key]);
			setHiddenTabsMap(next);
			if (activeTab === key) {
				onTabChange(dockedTabItems.find((item) => item.key !== key)?.key ?? "file");
			}
		},
		[
			cwd,
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
	const onRestoreTab = useCallback(
		(key: string) => {
			if (!cwd) return;
			const next = new Map(hiddenTabsMap);
			next.set(
				cwd,
				(next.get(cwd) ?? []).filter((hiddenKey) => hiddenKey !== key),
			);
			setHiddenTabsMap(next);
			onTabChange(key as ActivityTabKey);
		},
		[cwd, hiddenTabsMap, setHiddenTabsMap, onTabChange],
	);
	/** 从可添加池显式上栏插件 tab 并切过去（与 openActivityTab 同语义，不强制改宽度）。 */
	const onAttachPluginTab = useCallback(
		(key: string) => {
			if (!cwd || !key.startsWith("plugin:")) return;
			const attachKey = key.slice("plugin:".length);
			const nextAttached = withPluginTabVisibility(attachedPluginTabsMap, cwd, attachKey, true);
			if (nextAttached) setAttachedPluginTabsMap(nextAttached);
			onTabChange(key as ActivityTabKey);
			setOpen(true);
		},
		[cwd, attachedPluginTabsMap, setAttachedPluginTabsMap, onTabChange, setOpen],
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
		cwd !== null &&
		!knowledgeHistory &&
		(restorableTabs.length > 0 || overflowTabs.length > 0 || availablePluginTabs.length > 0);

	return {
		actions: {
			onAttachPluginTab,
			onClose,
			onFloatingResize: floating.actions.onFloatingResize,
			onFloatingResizeEnd: floating.actions.onFloatingResizeEnd,
			onFloatingTabDragEnd: floating.actions.onFloatingTabDragEnd,
			onFloatingTabDragMove: floating.actions.onFloatingTabDragMove,
			onFloatingTabDragStart: floating.actions.onFloatingTabDragStart,
			onFloatingTabFocus: floating.actions.onFloatingTabFocus,
			onOverflowChange: setOverflowKeys,
			onRemoveTab,
			onReorderTabs,
			onResize,
			onResizeEnd,
			onRestoreTab,
			onTabChange,
			onTabDragEnd: floating.actions.onDockedTabDragEnd,
			onTabDragMove: floating.actions.onDockedTabDragMove,
			onTabDragStart,
		},
		model: {
			activeTab,
			availablePluginTabs,
			bottomSheet: narrow && isOpen,
			cwd,
			dockPreviewBounds: narrow ? null : floating.model.dockPreviewBounds,
			floatingTabs: narrow ? [] : floating.model.floatingTabs,
			isOpen,
			isResizing,
			knowledgeHistory,
			mainTabListRef,
			mountedTabs,
			narrowSheet: narrow,
			overflowTabs,
			panelRef,
			restorableTabs,
			showTabPicker,
			tabItems: dockedTabItems,
			width,
		},
	};
}
