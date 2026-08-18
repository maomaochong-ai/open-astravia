import type { SidebarNavItemButton, SidebarNavigationProps } from "@vetta/theme-ui/sidebar";
import type { ComponentType } from "react";

export type {
	NavIndicatorBounds,
	SidebarNavItem,
} from "@vetta/theme-sdk/sidebar";
export type { SidebarNavItemButtonProps, SidebarNavigationProps } from "@vetta/theme-ui/sidebar";
export { SidebarNavItemButton, SidebarNavigation } from "@vetta/theme-ui/sidebar";

declare module "@vetta/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "sidebar.navItem"?: typeof SidebarNavItemButton;
		readonly "sidebar.navigation"?: ComponentType<SidebarNavigationProps>;
	}
}
