import type { JSX } from "react";
import type { SidebarNavBadge, SidebarNavBadgeTone } from "@vetta/theme-sdk/sidebar";
import { cn } from "@vetta/ui";
import { navBadgeText } from "./nav-badge-text";

/**
 * 导航项角标。置顶区按钮、「更多」弹层与收纳面板共用同一个实现——此前三处各写
 * 了一串一模一样的类名，加 count / dot 时必然分叉。
 */
export interface SidebarNavBadgeViewProps {
	badge: SidebarNavBadge;
	className?: string;
}

const TONE_PILL: Record<SidebarNavBadgeTone, string> = {
	default: "border-primary/40 text-primary",
	accent: "border-foreground/25 text-foreground/70",
	warning: "border-amber-500/40 text-amber-500",
	danger: "border-destructive/40 text-destructive",
};

const TONE_DOT: Record<SidebarNavBadgeTone, string> = {
	default: "bg-primary",
	accent: "bg-foreground/60",
	warning: "bg-amber-500",
	danger: "bg-destructive",
};

export function SidebarNavBadgeView({ badge, className }: SidebarNavBadgeViewProps): JSX.Element | null {
	const tone = badge.tone ?? "default";

	if (badge.kind === "dot") {
		return <span aria-hidden className={cn("relative z-10 h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone], className)} />;
	}

	const text = navBadgeText(badge);
	if (text === null) return null;

	return (
		<span
			className={cn(
				"relative z-10 shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold leading-tight tracking-wide",
				// 计数不做 uppercase：数字本身无所谓，但它会让 `99+` 的加号错位。
				badge.kind === "text" && "uppercase",
				TONE_PILL[tone],
				className,
			)}
		>
			{text}
		</span>
	);
}
