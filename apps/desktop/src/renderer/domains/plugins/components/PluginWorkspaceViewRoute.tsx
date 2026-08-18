import { pluginWorkspaceViewsAtom } from "@shared/store/atoms";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Component, useEffect, useState } from "react";
import type { ErrorInfo, JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { waitForPluginHostReady } from "../runtime/plugin-events";
import { PluginI18nBoundary } from "../runtime/plugin-i18n";
import { findWorkspaceView } from "../runtime/workspace-view-registry";

class WorkspaceViewErrorBoundary extends Component<
	{ viewKey: string; fallback: ReactNode; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error(`Plugin workspace view failed: ${this.props.viewKey}`, error, errorInfo.componentStack);
	}

	render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

function WorkspaceViewMessage({ text }: { text: string }): JSX.Element {
	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<div className="drag-region h-6 shrink-0" />
			<div className="flex flex-1 items-center justify-center px-8 pb-8 text-[13px] text-muted-foreground">{text}</div>
		</div>
	);
}

/**
 * 插件**工作区视图**的整页宿主。与主题页路由同构：路由只负责解析 + 兜底，
 * 内容区完全交给插件组件（它自己带 header / 布局）。
 *
 * 插件宿主是异步加载的，所以「找不到视图」有两种含义：宿主还没就绪（等）与
 * 宿主已就绪但确实没这条注册（回首页）。二者必须分开，否则冷启动直接把用户踢走。
 */
export function PluginWorkspaceViewRoute(): JSX.Element | null {
	const { t } = useTranslation("project");
	const navigate = useNavigate();
	const matches = useMatches();
	const params = matches[matches.length - 1]?.params as { pluginId?: string; viewId?: string } | undefined;
	const pluginId = params?.pluginId;
	const viewId = params?.viewId;
	const views = useAtomValue(pluginWorkspaceViewsAtom);
	const [hostReady, setHostReady] = useState(false);
	const view = findWorkspaceView(views, pluginId, viewId);

	useEffect(() => {
		let cancelled = false;
		void waitForPluginHostReady().then(() => {
			if (!cancelled) setHostReady(true);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (view || !hostReady) return;
		void navigate({ to: "/", replace: true });
	}, [view, hostReady, navigate]);

	if (!view) {
		return <WorkspaceViewMessage text={hostReady ? t("workspaceView.missing") : t("workspaceView.loading")} />;
	}

	const ViewComponent = view.component;
	const viewKey = `${view.pluginId}:${view.viewId}`;
	return (
		<div
			className="vetta-plugin relative flex h-full w-full flex-1 flex-col overflow-hidden"
			data-vetta-plugin-workspace-view={viewKey}
		>
			<WorkspaceViewErrorBoundary fallback={<WorkspaceViewMessage text={t("workspaceView.failed")} />} viewKey={viewKey}>
				<PluginI18nBoundary pluginId={view.pluginId}>
					<ViewComponent pluginId={view.pluginId} viewId={view.viewId} />
				</PluginI18nBoundary>
			</WorkspaceViewErrorBoundary>
		</div>
	);
}
