import type { SidebarNavItemButton, SidebarNavigationProps } from "@astravia-org/theme-ui/sidebar";
import type { ComponentType } from "react";

export type {
	NavIndicatorBounds,
	SidebarNavItem,
} from "@astravia-org/theme-sdk/sidebar";
export type { SidebarNavItemButtonProps, SidebarNavigationProps } from "@astravia-org/theme-ui/sidebar";
export { SidebarNavItemButton, SidebarNavigation } from "@astravia-org/theme-ui/sidebar";

declare module "@astravia-org/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "sidebar.navItem"?: typeof SidebarNavItemButton;
		readonly "sidebar.navigation"?: ComponentType<SidebarNavigationProps>;
	}
}
