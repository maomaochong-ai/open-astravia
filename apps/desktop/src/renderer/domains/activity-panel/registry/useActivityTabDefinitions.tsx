import { PluginActivityTabPanel } from "@domains/plugins/components/PluginActivityTabPanel";
import { usePluginTextResolver } from "@domains/plugins/runtime/plugin-i18n";
import {
	activeInputActionIdsAtom,
	currentScenarioAtom,
	pluginActivityTabsAtom,
	pluginInputActionsAtom,
	type RegisteredActivityTab,
} from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { type ComponentType, useMemo } from "react";
import { BUILTIN_ACTIVITY_TABS } from "../builtins";
import { DEFAULT_PLUGIN_TAB_ICON } from "../components/PluginTabPicker";
import { useActivityTabActivation } from "./activation-context";
import { useActivityPanelCwd } from "./context";
import type { ActivityTabDefinition } from "./types";

/** 缓存插件 tab 内容组件类型，避免每次 render 新建 Component 导致整树 remount。 */
const pluginComponentCache = new Map<string, ComponentType>();

function getPluginTabComponent(pluginId: string, tabId: string): ComponentType {
	const key = `${pluginId}:${tabId}`;
	let Comp = pluginComponentCache.get(key);
	if (!Comp) {
		Comp = function PluginActivityTabSlot(): JSX.Element | null {
			const tabs = useAtomValue(pluginActivityTabsAtom);
			const tab = tabs.find((entry) => entry.pluginId === pluginId && entry.tabId === tabId);
			const cwd = useActivityPanelCwd();
			const active = useActivityTabActivation();
			if (!tab) return null;
			return <PluginActivityTabPanel tab={tab} cwd={cwd} active={active} />;
		};
		pluginComponentCache.set(key, Comp);
	}
	return Comp;
}

export function toPluginDefinition(
	tab: RegisteredActivityTab,
	trPlugin: (pluginId: string, text: string) => string,
): ActivityTabDefinition {
	const id = `plugin:${tab.pluginId}:${tab.tabId}`;
	return {
		id,
		order: 100,
		removable: true,
		source: "plugin",
		pluginId: tab.pluginId,
		pluginName: trPlugin(tab.pluginId, tab.pluginName),
		scope_use: tab.scope_use,
		initiallyVisible: tab.initiallyVisible,
		retention: tab.retention,
		keepAliveWhenAvailable: tab.keepAliveWhenAvailable,
		useMeta: () => ({
			label: trPlugin(tab.pluginId, tab.label),
			icon: tab.icon ?? DEFAULT_PLUGIN_TAB_ICON,
		}),
		component: getPluginTabComponent(tab.pluginId, tab.tabId),
	};
}

export interface UseActivityTabDefinitionsOptions {
	enablePluginTabs?: boolean;
	/** 知识库会话：仅保留 knowledge-history。 */
	knowledgeHistory?: boolean;
}

/**
 * 合并内置注册表 + 当前场景下可用的插件 tab。
 * hardIsolation / scope_use 在此过滤；可见性（hidden / attach）留给 resolve 管道。
 */
export function useActivityTabDefinitions({
	enablePluginTabs = true,
	knowledgeHistory = false,
}: UseActivityTabDefinitionsOptions = {}): ActivityTabDefinition[] {
	const registeredPluginTabs = useAtomValue(pluginActivityTabsAtom);
	const pluginInputActions = useAtomValue(pluginInputActionsAtom);
	const activeInputActionIds = useAtomValue(activeInputActionIdsAtom);
	const currentScenario = useAtomValue(currentScenarioAtom);
	const trPlugin = usePluginTextResolver();

	const hardIsolationOffPluginIds = useMemo(() => {
		const off = new Set<string>();
		for (const action of pluginInputActions) {
			if (action.hardIsolation && !activeInputActionIds.has(action.actionId)) {
				off.add(action.pluginId);
			}
		}
		return off;
	}, [pluginInputActions, activeInputActionIds]);

	return useMemo(() => {
		if (knowledgeHistory) {
			return BUILTIN_ACTIVITY_TABS.filter((tab) => tab.id === "knowledge-history");
		}

		const builtins = BUILTIN_ACTIVITY_TABS.filter((tab) => tab.id !== "knowledge-history");

		if (!enablePluginTabs || currentScenario === null) {
			return [...builtins];
		}

		const plugins = registeredPluginTabs
			.filter(
				(tab) =>
					tab.scope_use?.includes(currentScenario) && !hardIsolationOffPluginIds.has(tab.pluginId),
			)
			.map((tab) => toPluginDefinition(tab, trPlugin));

		return [...builtins, ...plugins];
	}, [
		knowledgeHistory,
		enablePluginTabs,
		currentScenario,
		registeredPluginTabs,
		hardIsolationOffPluginIds,
		trPlugin,
	]);
}
