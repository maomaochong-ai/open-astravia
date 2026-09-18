import { pluginWorkspaceViewsAtom } from "@shared/store/atoms";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Component, useCallback, useEffect, useState } from "react";
import type { ErrorInfo, JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isPluginHostCycleReady, isPluginHostEverReady, waitForPluginHostReady } from "../runtime/plugin-events";
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
 * 插件工作区视图的宿主表面：解析注册表、兜底文案与错误边界都在这里，
 * 整页路由与设置页内嵌都用同一份实现，插件不需要知道自己被挂在哪。
 *
 * 插件宿主是异步加载的，所以「找不到视图」有两种含义：宿主还没就绪（等）与
 * 宿主已就绪但确实没这条注册（交给调用方兜底）。二者必须分开，否则冷启动会
 * 把用户直接踢走。
 *
 * 注册表里已经有这条视图时立刻渲染，不要为了等宿主再闪一帧 loading。
 * 只有视图缺失才等当前加载周期：宿主曾经就绪且没有新的 `markPluginHostLoading`
 * 时，首帧就能判定 missing，不必再空转一个 effect。
 */
export function PluginWorkspaceViewSurface({
	pluginId,
	viewId,
	onMissing,
	active = true,
}: {
	pluginId: string | undefined;
	viewId: string | undefined;
	/** 宿主已就绪但视图确实不存在时调用；不传则原地显示缺失文案。 */
	onMissing?: () => void;
	/**
	 * 当前是否是正在看的那一页。保活隐藏树在插件还没注册时不要 onMissing，
	 * 否则会把用户从别的页面踢回首页。
	 */
	active?: boolean;
}): JSX.Element {
	const { t } = useTranslation("project");
	const views = useAtomValue(pluginWorkspaceViewsAtom);
	const [hostReady, setHostReady] = useState(() => isPluginHostEverReady() && isPluginHostCycleReady());
	const view = findWorkspaceView(views, pluginId, viewId);

	useEffect(() => {
		if (view || hostReady) return;
		let cancelled = false;
		void waitForPluginHostReady().then(() => {
			if (!cancelled) setHostReady(true);
		});
		return () => {
			cancelled = true;
		};
	}, [view, hostReady]);

	useEffect(() => {
		if (!active || view || !hostReady) return;
		onMissing?.();
	}, [active, view, hostReady, onMissing]);

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

/** 插件工作区视图的整页路由：只负责把路由参数交给 surface，找不到就回首页。 */
export function PluginWorkspaceViewRoute(): JSX.Element | null {
	const navigate = useNavigate();
	const matches = useMatches();
	const params = matches[matches.length - 1]?.params as { pluginId?: string; viewId?: string } | undefined;
	const onMissing = useCallback(() => {
		void navigate({ to: "/", replace: true });
	}, [navigate]);

	return <PluginWorkspaceViewSurface pluginId={params?.pluginId} viewId={params?.viewId} onMissing={onMissing} />;
}
