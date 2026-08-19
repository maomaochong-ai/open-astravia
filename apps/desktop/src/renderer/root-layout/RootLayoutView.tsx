import { Outlet } from "@tanstack/react-router";
import { cn } from "@shared/lib/utils";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import { ThemeSurface } from "@vetta/theme-ui/appearance";
import { RouteContentLoadingView } from "@vetta/theme-ui/app";
import { AppFrame, MainContentFrame, SidebarDock, SidebarOverlay } from "@vetta/theme-ui/layout";
import { useThemeComponent, useThemeSurface } from "@vetta/theme-sdk";
import { useCallback, useEffect } from "react";
import { useActiveWorkspaceViewHeader } from "../domains/plugins/components/WorkspaceViewHeaderSlot";
import { Sidebar } from "../domains/project/components/sidebar/Sidebar";
import { PageHeader } from "../shared/app-shell/page-header";
import { TooltipProvider } from "../shared/components/ui/tooltip";
import { useActiveThemePageRoute } from "../shared/theme/pages";
import { SidebarTour } from "../shared/tour";
import { AppBackground } from "./app-background/AppBackground";
import { RootGlobalOverlays } from "./RootGlobalOverlays";
import type { RootLayoutModel } from "./types";

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
				decoration={<ThemedAppBackground />}
				overlay={<ThemeSurface className="z-20" slot="app.frameOverlay" />}
			>
				{showSidebar && (
					<>
						<SidebarDock className="sidebar-dock" visible={!narrow && !sidebarCollapsed}>
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
						{routePending ? <RouteContentLoadingView /> : <Outlet />}
					</div>
				) : (
					<MainContentFrame
						className="app-main-frame"
						header={pageHeader}
						headerOverlay={workspaceViewHeader?.immersive === true}
					>
						<PerfSendProfiler id="RouteOutlet">
							{routePending ? <RouteContentLoadingView /> : <Outlet />}
						</PerfSendProfiler>
					</MainContentFrame>
				)}
				<PerfSendProfiler id="RootGlobalOverlays">
					<RootGlobalOverlays />
				</PerfSendProfiler>
			</AppFrame>
			</PerfSendProfiler>
		</TooltipProvider>
	);
}
