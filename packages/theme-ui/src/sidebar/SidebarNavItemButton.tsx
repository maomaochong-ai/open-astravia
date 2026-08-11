import { forwardRef, type ComponentPropsWithoutRef, type JSX } from "react";
import type { SidebarNavItem } from "@vetta/theme-sdk/sidebar";
import { cn } from "@vetta/ui";
import { SidebarNavBadgeView } from "./SidebarNavBadgeView";

export interface SidebarNavItemButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
	classNames?: {
		badge?: string;
		icon?: string;
		label?: string;
	};
	item: SidebarNavItem;
}

/**
 * Props-driven nav item. Prefer resolved `item.label` / `item.title` from the model layer.
 * Falls back to labelKey/titleLabelKey only for display of pre-resolved strings if host still passes keys as labels.
 */
export const SidebarNavItemButton = forwardRef<HTMLButtonElement, SidebarNavItemButtonProps>(
	function SidebarNavItemButton({ className, classNames, item, onClick, ...props }, ref): JSX.Element {
		const label = item.label ?? item.labelKey ?? "";
		const title = item.title ?? item.titleLabelKey ?? label;

		const tourAnchor =
			item.path === "/skills"
				? "sidebar-nav-skills"
				: item.path
					? `sidebar-nav-${item.path.replace(/^\//, "")}`
					: item.type === "new-session"
						? "sidebar-nav-new-session"
						: undefined;

		return (
			<button
				ref={ref}
				type="button"
				onClick={onClick}
				title={title}
				data-tour={tourAnchor}
				className={cn(
					"no-drag relative z-20 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
					item.active ? "font-semibold text-foreground" : "text-foreground hover:bg-accent/50",
					className,
				)}
				{...props}
			>
				<span className={cn(item.icon, "relative z-10 h-4 w-4 shrink-0", classNames?.icon)} />
				{/* min-w-0 flex-1 truncate：label 占满中间并在过长时省略，右侧角标才不会被顶出按钮（与「更多」触发器同型）。 */}
				<span className={cn("relative z-10 min-w-0 flex-1 truncate text-left", classNames?.label)}>{label}</span>
				{item.badge && <SidebarNavBadgeView badge={item.badge} className={classNames?.badge} />}
			</button>
		);
	},
);
