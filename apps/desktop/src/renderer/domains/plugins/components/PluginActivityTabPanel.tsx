import { Component, useMemo } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { __ActivityTabContext } from "@vetta-org/plugin-sdk";
import type { RegisteredActivityTab } from "@shared/store/atoms";
import { PluginI18nBoundary } from "../runtime/plugin-i18n";

class PluginActivityTabErrorBoundary extends Component<
	{ tabKey: string; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error(`Plugin activity tab failed: ${this.props.tabKey}`, error, errorInfo.componentStack);
	}

	render(): ReactNode {
		if (this.state.failed) {
			return (
				<div className="flex min-h-0 flex-1 items-center justify-center p-4 text-[12px] text-muted-foreground">
					插件面板渲染失败
				</div>
			);
		}
		return this.props.children;
	}
}

/**
 * 渲染一个已 attach 的活动面板插件 tab（零 props 组件契约，与全局 slot 同构）。
 * 面板作用域 cwd 经 plugin-sdk 的 ActivityTabContext 注入，插件用 useActivityTab() 读取。
 */
export function PluginActivityTabPanel({
	tab,
	cwd,
	active,
}: {
	tab: RegisteredActivityTab;
	cwd: string | null;
	active: boolean;
}): JSX.Element {
	const TabComponent = tab.component;
	const tabKey = `${tab.pluginId}:${tab.tabId}`;
	const contextValue = useMemo(() => ({ cwd, active }), [cwd, active]);
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-vetta-plugin-activity-tab={tabKey}>
			<PluginActivityTabErrorBoundary tabKey={tabKey}>
				<PluginI18nBoundary pluginId={tab.pluginId}>
					<__ActivityTabContext.Provider value={contextValue}>
						<TabComponent />
					</__ActivityTabContext.Provider>
				</PluginI18nBoundary>
			</PluginActivityTabErrorBoundary>
		</div>
	);
}
