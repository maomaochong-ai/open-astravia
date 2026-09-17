import { DefaultSidebar as ThemeDefaultSidebar } from "@vetta-org/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import type { SidebarModel, SidebarProps } from "./types";
import { SidebarBottomBar } from "./SidebarBottomBar";
import { SidebarProjectsSection } from "./SidebarProjectsSection";
import { SidebarTopBar } from "./SidebarTopBar";
import { useDeferredSidebarProjects } from "./useDeferredSidebarProjects";

interface DefaultSidebarProps {
	classNames?: SidebarProps["classNames"];
	model: SidebarModel;
	onOpenSession: SidebarProps["onOpenSession"];
}

/**
 * Desktop default sidebar: props-driven shell from theme-ui + host-owned section trees.
 */
export function DefaultSidebar({ classNames, model, onOpenSession }: DefaultSidebarProps): JSX.Element {
	const { t } = useTranslation("project");
	// 展开动画期间先不挂重子树，见 useDeferredSidebarProjects。
	const projectsReady = useDeferredSidebarProjects();
	return (
		<ThemeDefaultSidebar
			classNames={classNames}
			model={model}
			navCustomizeLabels={{
				pinnedTitle: t("sidebar.nav.customize"),
				moreTitle: t("sidebar.nav.more"),
				pin: t("sidebar.nav.pin"),
				unpin: t("sidebar.nav.unpin"),
				pinFull: t("sidebar.nav.pinFull"),
				reset: t("sidebar.nav.reset"),
			}}
			topBar={
				<SidebarTopBar
					className="sidebar-top-bar"
					classNames={{
						actions: classNames?.topBarActions,
						brand: classNames?.topBarBrand,
						collapseButton: classNames?.topBarCollapseButton,
					}}
					floating={model.floating}
					onCollapse={model.actions.collapse}
				/>
			}
			projects={
				projectsReady ? (
					<SidebarProjectsSection
						classNames={{
							list: classNames?.projectsList,
							toolbar: classNames?.projectsToolbar,
						}}
						filter={model.filter}
						onOpenSession={onOpenSession}
					/>
				) : null
			}
			bottomBar={<SidebarBottomBar classNames={{ settings: classNames?.bottomBarSettings }} />}
		/>
	);
}
