import type { SidebarProps } from "../domains/project/components/sidebar/types";

export interface RootLayoutActions {
	closeOverlay: () => void;
	openOverlay: () => void;
	scheduleOverlayClose: () => void;
	toggleSidebar: () => void;
}

export interface RootLayoutModel {
	actions: RootLayoutActions;
	chatSurfaceActive: boolean;
	currentPath: string;
	narrow: boolean;
	onOpenSession: SidebarProps["onOpenSession"];
	overlayOpen: boolean;
	routePending: boolean;
	sidebarCollapsed: boolean;
	/** 左栏宽度（px）：左栏占位与侧边栏面板必须同源，见 SidebarDock。 */
	sidebarWidth: number;
}
