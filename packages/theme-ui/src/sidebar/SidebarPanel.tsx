import type { JSX, ReactNode } from "react";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import { cn } from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { ResizeHandle } from "../layout/ResizeHandle";

export interface SidebarPanelProps {
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	onResize: (delta: number) => void;
	onResizeEnd: () => void;
	width: number;
}

export function SidebarPanel({
	children,
	className,
	contentClassName,
	onResize,
	onResizeEnd,
	width,
}: SidebarPanelProps): JSX.Element {
	const surface = useThemeSurface("sidebar.panel");

	return (
		<div
			className={cn(
				"group/sidebar sidebar-surface relative h-full shrink-0 rounded-[10px] border border-border bg-muted",
				surface?.rootClassName,
				className,
			)}
			data-theme-surface-root="sidebar.panel"
			style={{ width }}
		>
			<ThemeSurface slot="sidebar.panel" />
			<div
				className={cn(
					"relative z-10 flex h-full flex-col overflow-hidden rounded-[inherit]",
					contentClassName,
				)}
			>
				{children}
			</div>
			<ResizeHandle side="right" onResize={onResize} onResizeEnd={onResizeEnd} />
		</div>
	);
}
