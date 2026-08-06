import { motion } from "motion/react";
import type { JSX, RefCallback } from "react";
import { useThemeComponent } from "@vetta/theme-sdk";
import type { NavIndicatorBounds, SidebarNavItem } from "@vetta/theme-sdk/sidebar";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { SidebarNavItemButton } from "./SidebarNavItemButton";

export interface SidebarNavigationProps {
	className?: string;
	classNames?: {
		indicator?: string;
		item?: string;
		itemBadge?: string;
		itemIcon?: string;
		itemLabel?: string;
	};
	indicatorBounds: NavIndicatorBounds | null;
	items: readonly SidebarNavItem[];
	moreActive?: boolean;
	moreItems?: readonly SidebarNavItem[];
	moreLabel?: string;
	moreOpen?: boolean;
	onItemClick: (item: SidebarNavItem) => void;
	onMoreOpenChange?: (open: boolean) => void;
	setItemRef: (index: number) => RefCallback<HTMLButtonElement>;
	setMoreButtonRef?: RefCallback<HTMLButtonElement>;
}

export function SidebarNavigation({
	className,
	classNames,
	indicatorBounds,
	items,
	moreActive = false,
	moreItems = [],
	moreLabel = "",
	moreOpen = false,
	onItemClick,
	onMoreOpenChange,
	setItemRef,
	setMoreButtonRef,
}: SidebarNavigationProps): JSX.Element {
	const ThemeNavItemButton = useThemeComponent("sidebar.navItem", SidebarNavItemButton);
	const hasMore = moreItems.length > 0;
	// 收纳项为当前路由时，触发器展示该项 label/icon；否则回落「更多」。
	const activeMoreItem = moreItems.find((item) => item.active);
	const triggerLabel = activeMoreItem?.label ?? moreLabel;
	const triggerIcon = activeMoreItem?.icon ?? "icon-[solar--alt-arrow-down-linear]";
	// 未展开且未选中收纳项时，icon/label 降到 50% 透明度，弱化次要入口。
	const moreIdle = !moreOpen && !activeMoreItem;

	return (
		<nav className={cn("relative flex flex-col gap-0.5 px-1.5 pb-2 pt-2", className)}>
			{indicatorBounds && (
				<motion.span
					className={cn(
						"pointer-events-none absolute z-10 overflow-visible rounded-md bg-accent",
						classNames?.indicator,
					)}
					initial={false}
					animate={{
						left: indicatorBounds.left,
						top: indicatorBounds.top,
						width: indicatorBounds.width,
						height: indicatorBounds.height,
					}}
					transition={{ type: "spring", stiffness: 430, damping: 28, mass: 0.75 }}
				>
					<ThemeSurface slot="sidebar.navigationIndicator" />
				</motion.span>
			)}
			{items.map((item, index) => (
				<ThemeNavItemButton
					className={classNames?.item}
					classNames={{
						badge: classNames?.itemBadge,
						icon: classNames?.itemIcon,
						label: classNames?.itemLabel,
					}}
					item={item}
					key={item.key}
					onClick={() => onItemClick(item)}
					ref={setItemRef(index)}
				/>
			))}
			{hasMore && (
				<Popover open={moreOpen} onOpenChange={onMoreOpenChange}>
					<PopoverTrigger asChild>
						<button
							ref={setMoreButtonRef}
							type="button"
							title={triggerLabel}
							className={cn(
								"no-drag relative z-20 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
								moreActive || moreOpen
									? "font-semibold text-foreground"
									: "text-foreground hover:bg-accent/50",
								classNames?.item,
							)}
						>
							<span
								className={cn(
									triggerIcon,
									"relative z-10 h-4 w-4 shrink-0 transition-[opacity,transform] duration-200",
									// 未选中收纳项时 leading 即 chevron，打开菜单时旋转。
									!activeMoreItem && moreOpen && "rotate-180",
									moreIdle && "opacity-50",
									classNames?.itemIcon,
								)}
							/>
							<span
								className={cn(
									"relative z-10 min-w-0 flex-1 truncate text-left transition-opacity duration-200",
									moreIdle && "opacity-50",
									classNames?.itemLabel,
								)}
							>
								{triggerLabel}
							</span>
							{activeMoreItem && (
								<span
									className={cn(
										"icon-[solar--alt-arrow-down-linear] relative z-10 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
										moreOpen && "rotate-180",
									)}
								/>
							)}
						</button>
					</PopoverTrigger>
					<PopoverContent
						side="right"
						align="start"
						sideOffset={8}
						className="w-[180px] gap-0.5 overflow-hidden rounded-lg border border-border p-1 shadow-md"
					>
						{moreItems.map((item) => (
							<button
								key={item.key}
								type="button"
								title={item.title ?? item.label}
								onClick={() => {
									onItemClick(item);
									onMoreOpenChange?.(false);
								}}
								className={cn(
									"flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
									item.active
										? "bg-accent font-semibold text-foreground"
										: "text-foreground hover:bg-accent/50",
								)}
							>
								<span className={cn(item.icon, "h-4 w-4 shrink-0")} />
								<span className="truncate">{item.label}</span>
								{item.badge && (
									<span className="ml-auto rounded-full border border-primary/40 px-1.5 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide text-primary">
										{item.badge}
									</span>
								)}
							</button>
						))}
					</PopoverContent>
				</Popover>
			)}
		</nav>
	);
}
