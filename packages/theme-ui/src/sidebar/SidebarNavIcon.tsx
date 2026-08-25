import type { SidebarNavItem } from "@vetta/theme-sdk/sidebar";
import { cn } from "@vetta/ui";
import type { JSX } from "react";

export interface SidebarNavIconProps {
	/** Class-string icon; also the fallback when no image is supplied. */
	icon: string;
	/** Full-color image icon; wins over `icon` and is never tinted. */
	iconUrl?: SidebarNavItem["iconUrl"];
	className?: string;
}

/**
 * One navigation icon. Class-string icons are masked to `currentColor` by their
 * utility class and therefore follow the theme; an `iconUrl` is rendered as a
 * plain `<img>` so plugin artwork keeps its own colors.
 *
 * Sizing/animation classes come from the call site and apply to both shapes.
 */
export function SidebarNavIcon({ className, icon, iconUrl }: SidebarNavIconProps): JSX.Element {
	if (iconUrl) {
		return (
			<img
				src={iconUrl}
				alt=""
				aria-hidden
				draggable={false}
				className={cn("h-4 w-4 shrink-0 object-contain", className)}
			/>
		);
	}
	return <span className={cn(icon, "h-4 w-4 shrink-0", className)} />;
}
