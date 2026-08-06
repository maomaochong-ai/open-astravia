import { Outlet } from "@tanstack/react-router";
import { cn } from "@shared/lib/utils";
import { ThemeSurface } from "@vetta/theme-ui/appearance";
import { RouteContentLoadingView } from "@vetta/theme-ui/app";
import { AppFrame, MainContentFrame, SidebarDock, SidebarOverlay } from "@vetta/theme-ui/layout";
import { useThemeComponent, useThemeSurface } from "@vetta/theme-sdk";
import { useCallback, useEffect } from "react";
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
			<PageHeader
				sidebarCollapsed={sidebarCollapsed}
				narrow={narrow}
				onExpandSidebar={actions.toggleSidebar}
				onOverlayOpen={actions.openOverlay}
				onOverlayClose={actions.scheduleOverlayClose}
			/>
		) : null;

	return (
		<TooltipProvider>
			<AppFrame
				className={cn("app-frame", appFrameSurface?.rootClassName)}
				decoration={<ThemedAppBackground />}
				overlay={<ThemeSurface className="z-20" slot="app.frameOverlay" />}
			>
				{showSidebar && (
					<>
						<SidebarDock className="sidebar-dock" visible={!narrow && !sidebarCollapsed}>
							<Sidebar onOpenSession={onOpenSession} onCollapse={actions.toggleSidebar} />
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
					<MainContentFrame className="app-main-frame" header={pageHeader}>
						{routePending ? <RouteContentLoadingView /> : <Outlet />}
					</MainContentFrame>
				)}
				<RootGlobalOverlays />
			</AppFrame>
		</TooltipProvider>
	);
}
