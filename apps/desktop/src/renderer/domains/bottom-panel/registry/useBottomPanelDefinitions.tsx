import {
	activeInputActionIdsAtom,
	pluginBottomPanelsAtom,
	pluginInputActionsAtom,
	type RegisteredBottomPanel,
} from "@shared/store/atoms";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import { useAtomValue } from "jotai";
import { type ComponentType, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_PLUGIN_TAB_ICON } from "../../activity-panel/components/PluginTabPicker";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { BUILTIN_BOTTOM_PANELS } from "../builtins";
import { PluginBottomPanelSlot } from "../components/PluginBottomPanelSlot";
import type { BottomPanelComponentDefinition } from "./types";

/**
 * 缓存插件面板的组件类型：每帧新建一个函数组件会让 React 认成新类型并整树 remount。
 * 对终端一类持有进程和 DOM 实例的面板，这不是性能问题而是功能问题。
 */
const pluginComponentCache = new Map<string, ComponentType>();

function getPluginPanelComponent(pluginId: string, panelId: string): ComponentType {
	const key = `${pluginId}:${panelId}`;
	let Component = pluginComponentCache.get(key);
	if (!Component) {
		Component = function PluginBottomPanelInstance(): JSX.Element | null {
			const panels = useAtomValue(pluginBottomPanelsAtom);
			const panel = panels.find((entry) => entry.pluginId === pluginId && entry.panelId === panelId);
			if (!panel) return null;
			return <PluginBottomPanelSlot panel={panel} />;
		};
		pluginComponentCache.set(key, Component);
	}
	return Component;
}

/** 插件自报的位置钳到内置之后：否则任何插件都能声明负数把终端挤下去。 */
const PLUGIN_PANEL_MIN_ORDER = 10;

export function toPluginBottomPanelDefinition(
	panel: RegisteredBottomPanel,
	trPlugin: (pluginId: string, text: string) => string,
): BottomPanelComponentDefinition {
	return {
		id: `plugin:${panel.pluginId}:${panel.panelId}`,
		order: Math.max(PLUGIN_PANEL_MIN_ORDER, panel.order ?? 100),
		source: "plugin",
		pluginId: panel.pluginId,
		pluginName: trPlugin(panel.pluginId, panel.pluginName),
		scope_use: panel.scope_use,
		maxInstances: panel.maxInstances,
		defaultMeta: {
			label: trPlugin(panel.pluginId, panel.label),
			icon: panel.icon ?? DEFAULT_PLUGIN_TAB_ICON,
		},
		component: getPluginPanelComponent(panel.pluginId, panel.panelId),
	};
}

export interface UseBottomPanelDefinitionsOptions {
	/** 当前会话的对话场景；缺省时插件贡献一律不参与（fail-closed）。 */
	readonly scenario?: ConversationScenario;
	/** 本机 PTY 是否可用；为否时需要它的内置组件不出现在「+」菜单里。 */
	readonly localPtyAvailable: boolean;
	/** 远程会话下终端走 SSH，本机是否有 PTY 与它无关。 */
	readonly remoteSession: boolean;
}

/**
 * 合并内置与当前场景下可用的插件面板。
 * 与活动面板一致：`scope_use` fail-closed，hardIsolation 关闭的插件整体退场。
 */
export function useBottomPanelDefinitions({
	scenario,
	localPtyAvailable,
	remoteSession,
}: UseBottomPanelDefinitionsOptions): BottomPanelComponentDefinition[] {
	const registeredPanels = useAtomValue(pluginBottomPanelsAtom);
	const pluginInputActions = useAtomValue(pluginInputActionsAtom);
	const activeInputActionIds = useAtomValue(activeInputActionIdsAtom);
	const trPlugin = usePluginTextResolver();

	const { t } = useTranslation("chat");

	const hardIsolationOffPluginIds = useMemo(() => {
		const off = new Set<string>();
		for (const action of pluginInputActions) {
			if (action.hardIsolation && !activeInputActionIds.has(action.actionId)) off.add(action.pluginId);
		}
		return off;
	}, [pluginInputActions, activeInputActionIds]);

	const builtins = useMemo(() => {
		return BUILTIN_BOTTOM_PANELS.map((builtin): BottomPanelComponentDefinition | null => {
			if (builtin.requiresLocalPty && !remoteSession && !localPtyAvailable) return null;
			return {
				id: builtin.id,
				order: builtin.order,
				source: "builtin",
				maxInstances: builtin.maxInstances,
				defaultMeta: { label: t(builtin.labelKey), icon: builtin.icon },
				component: builtin.component,
			};
		}).filter((definition): definition is BottomPanelComponentDefinition => definition !== null);
	}, [localPtyAvailable, remoteSession, t]);

	return useMemo(() => {
		if (scenario === undefined) return [...builtins];
		const plugins = registeredPanels
			.filter(
				(panel) => panel.scope_use?.includes(scenario) && !hardIsolationOffPluginIds.has(panel.pluginId),
			)
			.map((panel) => toPluginBottomPanelDefinition(panel, trPlugin));
		return [...builtins, ...plugins].sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
	}, [builtins, scenario, registeredPanels, hardIsolationOffPluginIds, trPlugin]);
}
