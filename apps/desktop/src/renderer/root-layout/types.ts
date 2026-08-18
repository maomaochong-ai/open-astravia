import type { SidebarProps } from "../domains/project/components/sidebar/types";

export interface RootLayoutActions {
	closeOverlay: () => void;
	openOverlay: () => void;
	scheduleOverlayClose: () => void;
	toggleSidebar: () => void;
}

export interface RootLayoutModel {
	actions: RootLayoutActions;
	narrow: boolean;
	onOpenSession: SidebarProps["onOpenSession"];
	overlayOpen: boolean;
	routePending: boolean;
	sidebarCollapsed: boolean;
}
