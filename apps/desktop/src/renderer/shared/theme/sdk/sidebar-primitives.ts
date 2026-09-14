import type { SidebarNavItemButton, SidebarNavigationProps } from "@vetta-org/theme-ui/sidebar";
import type { ComponentType } from "react";

export type {
	NavIndicatorBounds,
	SidebarNavItem,
} from "@vetta-org/theme-sdk/sidebar";
export type { SidebarNavItemButtonProps, SidebarNavigationProps } from "@vetta-org/theme-ui/sidebar";
export { SidebarNavItemButton, SidebarNavigation } from "@vetta-org/theme-ui/sidebar";

declare module "@vetta-org/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "sidebar.navItem"?: typeof SidebarNavItemButton;
		readonly "sidebar.navigation"?: ComponentType<SidebarNavigationProps>;
	}
}
