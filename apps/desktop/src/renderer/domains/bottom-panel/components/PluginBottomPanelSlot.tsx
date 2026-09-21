import type { RegisteredBottomPanel } from "@shared/store/atoms";
import {
	__BottomPanelContext,
	type PluginBottomPanelCloseDecision,
	type PluginBottomPanelCloseRequest,
	type PluginBottomPanelMeta,
} from "@vetta-org/plugin-sdk";
import { type JSX, useMemo } from "react";
import { PluginI18nBoundary } from "../../plugins/runtime/plugin-i18n";
import { useBottomPanelInstance } from "../registry/instance-context";

type PluginBottomPanelCloseGuard = (
	request: PluginBottomPanelCloseRequest,
) => PluginBottomPanelCloseDecision | Promise<PluginBottomPanelCloseDecision>;

/**
 * 挂载一个插件贡献的底部面板实例。
 *
 * 这里不再套 ErrorBoundary：`BottomPanelInstanceHost` 已经按实例隔离了渲染错误，
 * 内置和插件走同一层，不需要第二份兜底。
 */
export function PluginBottomPanelSlot({ panel }: { panel: RegisteredBottomPanel }): JSX.Element {
	const handle = useBottomPanelInstance();
	const PanelComponent = panel.component;
	const panelKey = `${panel.pluginId}:${panel.panelId}`;

	const contextValue = useMemo(
		() => ({
			instanceId: handle.tabId,
			cwd: handle.cwd,
			active: handle.active,
			setMeta: (meta: PluginBottomPanelMeta | null) => handle.setMeta(meta),
			// 对外合同用 instanceId，宿主内部叫 tabId；只在这一层换名，
			// 免得 SDK 的字段名跟着宿主实现漂移。
			setCloseGuard: (guard: PluginBottomPanelCloseGuard | null) =>
				handle.setCloseGuard(
					guard ? (request) => guard({ instanceId: request.tabId, reason: request.reason }) : null,
				),
		}),
		[handle],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-vetta-plugin-bottom-panel={panelKey}>
			<PluginI18nBoundary pluginId={panel.pluginId}>
				<__BottomPanelContext.Provider value={contextValue}>
					<PanelComponent />
				</__BottomPanelContext.Provider>
			</PluginI18nBoundary>
		</div>
	);
}
