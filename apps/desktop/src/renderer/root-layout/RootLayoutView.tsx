import { Outlet } from "@tanstack/react-router";
import { cn } from "@shared/lib/utils";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import { ThemeSurface } from "@vetta-org/theme-ui/appearance";
import { RouteContentLoadingView } from "@vetta-org/theme-ui/app";
import { AppFrame, MainContentFrame, SidebarDock, SidebarOverlay } from "@vetta-org/theme-ui/layout";
import { useThemeComponent, useThemeSurface } from "@vetta-org/theme-sdk";
import { memo, useCallback, useEffect } from "react";
import { CommandMenu } from "../domains/command-menu/components/CommandMenu";
import { useActiveWorkspaceViewHeader } from "../domains/plugins/components/WorkspaceViewHeaderSlot";
import { Sidebar } from "../domains/project/components/sidebar/Sidebar";
import { PageHeader } from "../shared/app-shell/page-header";
import { TooltipProvider } from "../shared/components/ui/tooltip";
import { useActiveThemePageRoute } from "../shared/theme/pages";
import { SidebarTour } from "../shared/tour";
import { AppBackground } from "./app-background/AppBackground";
import { RootGlobalOverlays } from "./RootGlobalOverlays";
import type { RootLayoutModel } from "./types";

/**
 * 路由内容独立成 memo：侧边栏折叠状态就在本文件的 model 里，不隔离的话每次展开/收起都会
 * 把整棵内容树重渲染一遍——插件的整页工作区视图动辄几十个节点一棵（风格墙一屏 25 张卡），
 * 一次 toggle 实测多出 ~28ms 的同步渲染，正好吃掉滑动的第一帧。
 *
 * 内容树不需要这个状态：形态走 AppFrame 上的 data-sidebar-* 属性（CSS 自适应），需要响应
 * 的插件走 ctx.ui 的订阅，两条都不经过这里的 render。
 */
const RouteContent = memo(function RouteContent({ routePending }: { routePending: boolean }): JSX.Element {
	return (
		<PerfSendProfiler id="RouteOutlet">
			{routePending ? <RouteContentLoadingView /> : <Outlet />}
		</PerfSendProfiler>
	);
});

interface RootLayoutViewProps {
	model: RootLayoutModel;
}

export function RootLayoutView({ model }: RootLayoutViewProps): JSX.Element {
	const ThemedAppBackground = useThemeComponent("app.background", AppBackground);
	const appFrameSurface = useThemeSurface("app.frame");
	const themePageRoute = useActiveThemePageRoute();
	const pageLayout = themePageRoute?.page ? themePageRoute.layout : "content";
	// 插件工作区视图可声明沉浸式页头：页头浮在内容之上（拖拽区/触发器照常在最上层），
	// 内容占满全高，视图自己的门面从窗口第一像素开始，不再被 44px 页头推出一条空带。
	const workspaceViewHeader = useActiveWorkspaceViewHeader();
	const {
		actions,
		narrow,
		onOpenSession,
		overlayOpen,
		routePending,
		sidebarCollapsed,
		sidebarWidth,
	} = model;
	const showSidebar = pageLayout !== "app";
	const ensureSidebarVisible = useCallback(() => {
		if (narrow) actions.openOverlay();
	}, [actions.openOverlay, narrow]);
	useEffect(() => {
		if (routePending) return;
		let contentPaintFrame = 0;
		const layoutFrame = requestAnimationFrame(() => {
			contentPaintFrame = requestAnimationFrame(() => {
				window.vetta.appLifecycle.reportRendererContentPainted();
			});
		});
		return () => {
			cancelAnimationFrame(layoutFrame);
			if (contentPaintFrame !== 0) cancelAnimationFrame(contentPaintFrame);
		};
	}, [routePending]);
	const pageHeader =
		pageLayout === "content" ? (
			<PerfSendProfiler id="PageHeader">
				<PageHeader
				// 顶栏左簇（展开侧边栏 / 新会话 / 标题）用统一的 4px 间距：
				// 图标按钮自带内边距，默认 8px 会让两枚图标看起来散开。
				classNames={{ left: "gap-1" }}
				sidebarCollapsed={sidebarCollapsed}
				narrow={narrow}
				onExpandSidebar={actions.toggleSidebar}
				onOverlayOpen={actions.openOverlay}
				onOverlayClose={actions.scheduleOverlayClose}
				/>
			</PerfSendProfiler>
		) : null;

	return (
		<TooltipProvider>
			<PerfSendProfiler id="Root(total)">
			<AppFrame
				className={cn("app-frame", appFrameSurface?.rootClassName)}
				// 侧边栏形态挂到整帧根节点上，让任意深度的子树（含插件视图）只靠 CSS 就能自适应，
				// 不必订阅状态再重渲染。始终写死 true/false，选择器才好写。
				// 与 ctx.ui.getSidebarState() / useSidebarState() 同源，见 shared/app-shell/sidebar-state.ts。
				data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
				data-sidebar-narrow={narrow ? "true" : "false"}
				data-sidebar-visible={!narrow && !sidebarCollapsed ? "true" : "false"}
				decoration={<ThemedAppBackground />}
				overlay={<ThemeSurface className="z-20" slot="app.frameOverlay" />}
			>
				{showSidebar && (
					<>
						<SidebarDock
							className="sidebar-dock"
							visible={!narrow && !sidebarCollapsed}
							width={sidebarWidth}
						>
							<PerfSendProfiler id="Sidebar">
								<Sidebar onOpenSession={onOpenSession} onCollapse={actions.toggleSidebar} />
							</PerfSendProfiler>
						</SidebarDock>
						<SidebarOverlay
							visible={narrow && overlayOpen}
							onMouseEnter={actions.openOverlay}
							onMouseLeave={actions.scheduleOverlayClose}
						>
							<Sidebar onOpenSession={onOpenSession} onCollapse={actions.closeOverlay} floating />
						</SidebarOverlay>
						<SidebarTour onEnsureSidebarVisible={ensureSidebarVisible} />
					</>
				)}
				{pageLayout === "app" ? (
					<div className="app-main-frame relative flex min-h-0 min-w-[320px] flex-1 overflow-visible">
						<RouteContent routePending={routePending} />
					</div>
				) : (
					<MainContentFrame
						className="app-main-frame"
						header={pageHeader}
						headerOverlay={workspaceViewHeader?.immersive === true}
					>
						<RouteContent routePending={routePending} />
					</MainContentFrame>
				)}
				{/* 复用 Sidebar 那条 onOpenSession：会话打开的落点逻辑只应有一处宿主实现。 */}
				<CommandMenu onOpenSession={onOpenSession} />
				<PerfSendProfiler id="RootGlobalOverlays">
					<RootGlobalOverlays />
				</PerfSendProfiler>
			</AppFrame>
			</PerfSendProfiler>
		</TooltipProvider>
	);
}
