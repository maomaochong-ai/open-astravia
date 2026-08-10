import type { JSX, ReactNode } from "react";
import { useThemeComponent } from "@vetta/theme-sdk";
import type { SidebarClassNames, SidebarModel } from "@vetta/theme-sdk/sidebar";
import { cn } from "@vetta/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { SidebarNavigation } from "./SidebarNavigation";
import type { SidebarNavMorePanelLabels } from "./SidebarNavMorePanel";
import { SidebarPanel } from "./SidebarPanel";

export interface DefaultSidebarProps {
	bottomBar: ReactNode;
	/** 「更多」自定义面板文案（宿主解析 i18n 后传入）。 */
	navCustomizeLabels?: SidebarNavMorePanelLabels;
	classNames?: SidebarClassNames;
	model: SidebarModel;
	projects: ReactNode;
	topBar: ReactNode;
}

/**
 * Props-driven sidebar shell. Host supplies connected section trees via topBar / projects / bottomBar.
 * Navigation is composed here from model so component overrides (`sidebar.navigation`) still apply.
 */
export function DefaultSidebar({
	bottomBar,
	classNames,
	model,
	navCustomizeLabels,
	projects,
	topBar,
}: DefaultSidebarProps): JSX.Element {
	const ThemedSidebarNavigation = useThemeComponent("sidebar.navigation", SidebarNavigation);

	return (
		<SidebarPanel
			className={classNames?.panel}
			contentClassName={classNames?.panelContent}
			width={model.width}
			onResize={model.actions.resize}
			onResizeEnd={model.actions.resizeEnd}
		>
			<div className={cn("relative shrink-0", classNames?.topBar)} data-theme-surface-root="sidebar.topBar">
				<ThemeSurface slot="sidebar.topBar" />
				<div className="relative z-10 overflow-hidden rounded-[inherit]">{topBar}</div>
			</div>
			<div className={cn("relative shrink-0", classNames?.navigation)} data-theme-surface-root="sidebar.navigation">
				<ThemeSurface slot="sidebar.navigation" />
				<div className="relative z-10 overflow-hidden rounded-[inherit]">
					<ThemedSidebarNavigation
						classNames={{
							indicator: classNames?.navIndicator,
							item: classNames?.navItem,
							itemBadge: classNames?.navItemBadge,
							itemIcon: classNames?.navItemIcon,
							itemLabel: classNames?.navItemLabel,
						}}
						items={model.navItems}
						canPinMore={model.canPinMore}
						navCustomizeLabels={navCustomizeLabels}
						indicatorBounds={model.navIndicatorBounds}
						moreActive={model.moreActive}
						moreItems={model.moreNavItems}
						moreLabel={model.moreLabel}
						moreOpen={model.moreOpen}
						onItemClick={model.actions.openNavItem}
						onMoreOpenChange={model.actions.setMoreOpen}
						onNavMove={model.actions.moveNavItem}
						onPinNavItem={model.actions.pinNavItem}
						onUnpinNavItem={model.actions.unpinNavItem}
						onResetNavLayout={model.actions.resetNavLayout}
						setItemRef={model.setNavItemRef}
						setMoreButtonRef={model.setMoreButtonRef}
					/>
				</div>
			</div>
			<div
				className={cn("relative flex min-h-0 flex-1 flex-col", classNames?.projects)}
				data-theme-surface-root="sidebar.projects"
			>
				<ThemeSurface slot="sidebar.projects" />
				<div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
					{projects}
				</div>
			</div>
			<div className={cn("relative shrink-0", classNames?.bottomBar)} data-theme-surface-root="sidebar.bottomBar">
				<ThemeSurface slot="sidebar.bottomBar" />
				<div className="relative z-10 overflow-hidden rounded-[inherit]">{bottomBar}</div>
			</div>
		</SidebarPanel>
	);
}
