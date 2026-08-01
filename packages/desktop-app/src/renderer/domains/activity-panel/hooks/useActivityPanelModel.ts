import { withPluginTabVisibility } from "@domains/plugins/runtime/attached-tabs";
import type { TabBarItem } from "@shared/components/ui/tab-bar";
import { useNarrowScreen, useWindowWidth } from "@shared/hooks/useNarrowScreen";
import { type ActivityTabKey, useProjectProfile } from "@shared/lib/project-profile";
import {
	ACTIVITY_PANEL_MIN_CHAT_AREA,
	ACTIVITY_PANEL_MIN_WIDTH,
	activityPanelMaxWidth,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	activityPanelWidthAtom,
	activityTabOrderAtom,
	attachedPluginTabsAtom,
	hiddenActivityTabsAtom,
	sidebarCollapsedAtom,
	sidebarWidthAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityPanelActions, ActivityPanelModel, ActivityPanelProps } from "../components/activity-panel/types";
import { resolveActivityTabs } from "../registry/resolve-activity-tabs";
import type { ActivityTabDefinition, ActivityTabId, ActivityTabMeta, ResolvedActivityTab } from "../registry/types";

const NON_HIDEABLE_TABS = new Set<string>(["file", "knowledge-history"]);

function toTabBarItem(tab: ResolvedActivityTab): TabBarItem<ActivityTabKey> {
	return {
		key: tab.id as ActivityTabKey,
		label: tab.label,
		icon: typeof tab.icon === "string" ? tab.icon : undefined,
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
	const [isResizing, setIsResizing] = useState(false);
	const [overflowKeys, setOverflowKeys] = useState<ActivityTabKey[]>([]);
	const [tabByProject, setTabByProject] = useAtom(activityPanelTabByProjectAtom);
	const windowWidth = useWindowWidth();
	const sidebarWidth = useAtomValue(sidebarWidthAtom);
	const maxWidth = activityPanelMaxWidth(windowWidth);
	const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
	const widthCollapsedSidebarRef = useRef<boolean | null>(null);
	const prevSidebarCollapsedRef = useRef(sidebarCollapsed);
	const { profile } = useProjectProfile(cwd);

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
				icon: typeof item.icon === "string" ? item.icon : undefined,
			})),
		[resolved.restorable],
	);
	const availablePluginTabs = useMemo(
		() =>
			resolved.availablePlugins.map((item) => ({
				key: item.id,
				label: item.label,
				icon: typeof item.icon === "string" ? item.icon : undefined,
				subtitle: item.pluginName,
			})),
		[resolved.availablePlugins],
	);

	const definitionById = useMemo(() => {
		const map = new Map<string, ActivityTabDefinition>();
		for (const def of definitions) map.set(def.id, def);
		return map;
	}, [definitions]);

	const onResize = useCallback(
		(delta: number) => {
			setIsResizing(true);
			setWidth((currentWidth) => Math.min(maxWidth, Math.max(ACTIVITY_PANEL_MIN_WIDTH, currentWidth + delta)));
		},
		[maxWidth, setWidth],
	);
	const onResizeEnd = useCallback(() => setIsResizing(false), []);
	const onClose = useCallback(() => setOpen(false), [setOpen]);

	useEffect(() => {
		setWidth((currentWidth) => Math.min(maxWidth, Math.max(ACTIVITY_PANEL_MIN_WIDTH, currentWidth)));
	}, [maxWidth, setWidth]);

	useEffect(() => {
		const openLimit = Math.max(ACTIVITY_PANEL_MIN_WIDTH, windowWidth - sidebarWidth - ACTIVITY_PANEL_MIN_CHAT_AREA);
		const collapsedChanged = prevSidebarCollapsedRef.current !== sidebarCollapsed;
		prevSidebarCollapsedRef.current = sidebarCollapsed;

		if (collapsedChanged && !sidebarCollapsed && isOpen && width > openLimit) {
			widthCollapsedSidebarRef.current = null;
			setWidth(openLimit);
			return;
		}

		const shouldCollapse = isOpen && width > openLimit;
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
	}, [width, windowWidth, sidebarWidth, isOpen, sidebarCollapsed, setSidebarCollapsed, setWidth]);

	const activeTab = useMemo<ActivityTabKey>(() => {
		if (knowledgeHistory) return "knowledge-history";
		if (cwd) {
			const remembered = tabByProject.get(cwd);
			if (remembered && tabItems.some((item) => item.key === remembered)) return remembered;
			// Keep plugin tab sticky while contributions briefly disappear (reload / hot reload).
			// Falling back to "file" mounts FileTabContent and its unmount cleanup can reset width.
			if (remembered?.startsWith("plugin:")) return remembered;
		}
		const fallback = profile?.defaultActivityTab ?? "file";
		if (tabItems.some((item) => item.key === fallback)) return fallback;
		return tabItems[0]?.key ?? fallback;
	}, [knowledgeHistory, cwd, tabByProject, profile, tabItems]);

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

	const activeDefinition = definitionById.get(activeTab) ?? null;

	/** 需保活的候选（含当前激活项）：始终挂载，View 用 CSS 显隐，避免 webview remount。 */
	const keepAliveTabs = useMemo(
		() => resolved.candidates.filter((item) => item.definition.keepAliveWhenAvailable),
		[resolved.candidates],
	);

	const onRemoveTab = useCallback(
		(key: ActivityTabKey) => {
			if (!cwd || NON_HIDEABLE_TABS.has(key)) return;
			const def = definitionById.get(key);
			if (def && def.removable === false) return;

			// 插件 tab：写显式下栏，回到「+」可添加池（不进 hidden 列表）。
			if (key.startsWith("plugin:")) {
				const attachKey = key.slice("plugin:".length);
				const nextAttached = withPluginTabVisibility(attachedPluginTabsMap, cwd, attachKey, false);
				if (nextAttached) setAttachedPluginTabsMap(nextAttached);
				if (activeTab === key) {
					onTabChange(tabItems.find((item) => item.key !== key)?.key ?? "file");
				}
				return;
			}
			const next = new Map(hiddenTabsMap);
			const current = next.get(cwd) ?? [];
			if (!current.includes(key)) next.set(cwd, [...current, key]);
			setHiddenTabsMap(next);
			if (activeTab === key) {
				onTabChange(tabItems.find((item) => item.key !== key)?.key ?? "file");
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
			tabItems,
			onTabChange,
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
			if (!cwd) return;
			const next = new Map(tabOrderMap);
			next.set(cwd, keys);
			setTabOrderMap(next);
		},
		[cwd, tabOrderMap, setTabOrderMap],
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
			onOverflowChange: setOverflowKeys,
			onRemoveTab,
			onReorderTabs,
			onResize,
			onResizeEnd,
			onRestoreTab,
			onTabChange,
		},
		model: {
			activeDefinition,
			activeTab,
			availablePluginTabs,
			bottomSheet: narrow && isOpen,
			cwd,
			isOpen,
			isResizing,
			keepAliveTabs,
			knowledgeHistory,
			narrowSheet: narrow,
			overflowTabs,
			restorableTabs,
			showTabPicker,
			tabItems,
			width,
		},
	};
}
