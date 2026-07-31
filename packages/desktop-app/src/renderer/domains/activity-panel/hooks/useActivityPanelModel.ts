import { explicitTabVisibility } from "@domains/plugins/runtime/attached-tabs";
import { usePluginTextResolver } from "@domains/plugins/runtime/plugin-i18n";
import type { TabBarItem } from "@shared/components/ui/tab-bar";
import { useNarrowScreen, useWindowWidth } from "@shared/hooks/useNarrowScreen";
import { type ActivityTabKey, useProjectProfile } from "@shared/lib/project-profile";
import {
	ACTIVITY_PANEL_MIN_CHAT_AREA,
	ACTIVITY_PANEL_MIN_WIDTH,
	activeInputActionIdsAtom,
	activeSessionAtom,
	activityPanelMaxWidth,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	activityPanelWidthAtom,
	activityTabOrderAtom,
	attachedPluginTabsAtom,
	backgroundTasksBySessionAtom,
	browserUrlBySessionAtom,
	currentScenarioAtom,
	debugModeAtom,
	getBackgroundTasksForSession,
	getBrowserUrlForSession,
	getSubagentsForSession,
	getTodoItemsForSession,
	hiddenActivityTabsAtom,
	isSubagentActive,
	isWorkflowTask,
	pluginActivityTabsAtom,
	pluginInputActionsAtom,
	sidebarCollapsedAtom,
	sidebarWidthAtom,
	subagentsBySessionAtom,
	todoItemsBySessionAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityPanelActions, ActivityPanelModel, ActivityPanelProps } from "../components/activity-panel/types";
import { DEFAULT_PLUGIN_TAB_ICON } from "../components/PluginTabPicker";

const NON_HIDEABLE_TABS = new Set<ActivityTabKey>(["file", "knowledge-history"]);

function applyTabOrder<T extends { key: ActivityTabKey }>(items: T[], order: string[]): T[] {
	if (order.length === 0) return items;
	const rank = (key: string): number => {
		const index = order.indexOf(key);
		return index === -1 ? Number.MAX_SAFE_INTEGER : index;
	};
	return items
		.map((item, index) => ({ item, index }))
		.sort((a, b) => rank(a.item.key) - rank(b.item.key) || a.index - b.index)
		.map(({ item }) => item);
}

export function useActivityPanelModel({
	cwd: cwdProp,
	enablePluginTabs = true,
	knowledgeHistory = false,
}: ActivityPanelProps = {}): { actions: ActivityPanelActions; model: ActivityPanelModel } {
	const { t } = useTranslation("chat");
	const [isOpen, setOpen] = useAtom(activityPanelOpenAtom);
	const narrow = useNarrowScreen();
	const activeSession = useAtomValue(activeSessionAtom);
	const browserUrlMap = useAtomValue(browserUrlBySessionAtom);
	const attachedPluginTabsMap = useAtomValue(attachedPluginTabsAtom);
	const browserUrl = getBrowserUrlForSession(browserUrlMap, activeSession?.sessionPath ?? null);
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
	const cwd = cwdProp ?? activeSession?.cwd ?? null;
	const { profile } = useProjectProfile(cwd);
	const todoMap = useAtomValue(todoItemsBySessionAtom);
	const todoItems = useMemo(
		() => getTodoItemsForSession(todoMap, activeSession?.runtimeId ?? null),
		[todoMap, activeSession?.runtimeId],
	);
	const backgroundTasksMap = useAtomValue(backgroundTasksBySessionAtom);
	const backgroundTasks = useMemo(
		() => getBackgroundTasksForSession(backgroundTasksMap, activeSession?.runtimeId ?? null),
		[backgroundTasksMap, activeSession?.runtimeId],
	);
	const subagentsMap = useAtomValue(subagentsBySessionAtom);
	const allSubagents = useMemo(
		() => getSubagentsForSession(subagentsMap, activeSession?.runtimeId ?? null),
		[subagentsMap, activeSession?.runtimeId],
	);
	// Workflows live in their own tab; background-tasks keeps bash + non-workflow subagents.
	const subagents = useMemo(() => allSubagents.filter((a) => !isWorkflowTask(a)), [allSubagents]);
	const workflows = useMemo(() => allSubagents.filter(isWorkflowTask), [allSubagents]);
	const debugMode = useAtomValue(debugModeAtom);
	const registeredPluginTabs = useAtomValue(pluginActivityTabsAtom);
	const pluginInputActions = useAtomValue(pluginInputActionsAtom);
	const activeInputActionIds = useAtomValue(activeInputActionIdsAtom);
	const trPlugin = usePluginTextResolver();
	const currentScenario = useAtomValue(currentScenarioAtom);
	const tabVisibilityRecords = useMemo(
		() => (cwd ? (attachedPluginTabsMap.get(cwd) ?? []) : []),
		[attachedPluginTabsMap, cwd],
	);
	/** Plugin ids whose hard-isolation toggle is currently off (ADR-0041). */
	const hardIsolationOffPluginIds = useMemo(() => {
		const off = new Set<string>();
		for (const action of pluginInputActions) {
			if (action.hardIsolation && !activeInputActionIds.has(action.actionId)) {
				off.add(action.pluginId);
			}
		}
		return off;
	}, [pluginInputActions, activeInputActionIds]);
	// 插件 tab 的可见性：插件显式表过态（setActivityTabVisible / openActivityTab）
	// 就听插件的，否则看它注册时的 initiallyVisible（缺省 true，注册即上栏）。
	// 外加 scope_use（fail-closed）与硬隔离开关（ADR-0041）两道闸。
	const pluginTabContribs = useMemo(
		() =>
			enablePluginTabs && currentScenario !== null
				? registeredPluginTabs.filter(
						(tab) =>
							tab.scope_use?.includes(currentScenario) &&
							!hardIsolationOffPluginIds.has(tab.pluginId) &&
							(explicitTabVisibility(tabVisibilityRecords, `${tab.pluginId}:${tab.tabId}`) ??
								tab.initiallyVisible !== false),
					)
				: [],
		[enablePluginTabs, registeredPluginTabs, currentScenario, hardIsolationOffPluginIds, tabVisibilityRecords],
	);
	const [hiddenTabsMap, setHiddenTabsMap] = useAtom(hiddenActivityTabsAtom);
	const [tabOrderMap, setTabOrderMap] = useAtom(activityTabOrderAtom);
	const hiddenKeys = useMemo(() => (cwd ? (hiddenTabsMap.get(cwd) ?? []) : []), [cwd, hiddenTabsMap]);
	const tabOrder = useMemo(() => (cwd ? (tabOrderMap.get(cwd) ?? []) : []), [cwd, tabOrderMap]);

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

	const allTabItems = useMemo<TabBarItem<ActivityTabKey>[]>(() => {
		if (knowledgeHistory) {
			return [
				{
					key: "knowledge-history",
					label: t("activityPanel.tabs.knowledgeHistory"),
					icon: "icon-[mdi--history]",
				},
			];
		}
		const base: TabBarItem<ActivityTabKey>[] = (profile?.activityTabs ?? []).map((tab) => ({
			key: tab.key,
			label: t(tab.label),
			icon: tab.icon,
			removable: !NON_HIDEABLE_TABS.has(tab.key),
		}));
		if (browserUrl) {
			base.push({
				key: "browser",
				label: t("browser.tab"),
				icon: "icon-[mdi--web]",
				removable: true,
			});
		}
		if (todoItems.length > 0) {
			const done = todoItems.filter((item) => item.status === "done").length;
			base.push({
				key: "todo",
				label: t("activityPanel.tabs.todo"),
				icon: "icon-[mdi--checkbox-marked-circle-outline]",
				badge: todoItems.length - done || undefined,
				removable: true,
			});
		}
		if (backgroundTasks.length > 0 || subagents.length > 0) {
			const runningBash = backgroundTasks.filter((task) => task.status === "running").length;
			const runningSub = subagents.filter((a) => isSubagentActive(a.status)).length;
			const running = runningBash + runningSub;
			base.push({
				key: "background-tasks",
				label: t("activityPanel.tabs.backgroundTasks"),
				icon: "icon-[mdi--console-line]",
				badge: running || undefined,
				removable: true,
			});
		}
		if (workflows.length > 0) {
			const runningWorkflows = workflows.filter((a) => isSubagentActive(a.status)).length;
			base.push({
				key: "workflow",
				label: t("activityPanel.tabs.workflow"),
				icon: "icon-[mdi--sitemap-outline]",
				badge: runningWorkflows || undefined,
				removable: true,
			});
		}
		if (debugMode) {
			base.push({
				key: "debug",
				label: t("activityPanel.tabs.debug"),
				icon: "icon-[mdi--bug-outline]",
				removable: true,
			});
		}
		for (const tab of pluginTabContribs) {
			base.push({
				key: `plugin:${tab.pluginId}:${tab.tabId}` as ActivityTabKey,
				label: trPlugin(tab.pluginId, tab.label),
				icon: tab.icon ?? DEFAULT_PLUGIN_TAB_ICON,
				removable: true,
			});
		}
		return base;
	}, [
		knowledgeHistory,
		profile,
		todoItems,
		backgroundTasks,
		subagents,
		workflows,
		debugMode,
		pluginTabContribs,
		browserUrl,
		trPlugin,
		t,
	]);
	const tabItems = useMemo(
		() =>
			applyTabOrder(
				allTabItems.filter((item) => !hiddenKeys.includes(item.key)),
				tabOrder,
			),
		[allTabItems, hiddenKeys, tabOrder],
	);
	const restorableTabs = useMemo(
		() =>
			allTabItems
				.filter((item) => hiddenKeys.includes(item.key))
				.map((item) => ({ key: item.key, label: item.label, icon: item.icon })),
		[allTabItems, hiddenKeys],
	);
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

	useEffect(() => {
		if (!cwd) return;
		const remembered = tabByProject.get(cwd);
		if (!remembered || !hiddenKeys.includes(remembered)) return;
		if (!allTabItems.some((item) => item.key === remembered)) return;
		const next = new Map(hiddenTabsMap);
		next.set(
			cwd,
			(next.get(cwd) ?? []).filter((key) => key !== remembered),
		);
		setHiddenTabsMap(next);
	}, [cwd, tabByProject, hiddenKeys, allTabItems, hiddenTabsMap, setHiddenTabsMap]);

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
	const activePluginTab = useMemo(() => {
		if (!activeTab.startsWith("plugin:")) return null;
		return pluginTabContribs.find((tab) => `plugin:${tab.pluginId}:${tab.tabId}` === activeTab) ?? null;
	}, [activeTab, pluginTabContribs]);
	const onRemoveTab = useCallback(
		(key: ActivityTabKey) => {
			if (!cwd || NON_HIDEABLE_TABS.has(key)) return;
			const next = new Map(hiddenTabsMap);
			const current = next.get(cwd) ?? [];
			if (!current.includes(key)) next.set(cwd, [...current, key]);
			setHiddenTabsMap(next);
			if (activeTab === key) {
				onTabChange(tabItems.find((item) => item.key !== key)?.key ?? "file");
			}
		},
		[cwd, hiddenTabsMap, setHiddenTabsMap, activeTab, tabItems, onTabChange],
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
	const showTabPicker = cwd !== null && !knowledgeHistory && (restorableTabs.length > 0 || overflowTabs.length > 0);

	return {
		actions: {
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
			activePluginTab,
			activeTab,
			bottomSheet: narrow && isOpen,
			browserUrl,
			cwd,
			isOpen,
			isResizing,
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
