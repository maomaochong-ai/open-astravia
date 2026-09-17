import type { JSX, ReactNode, RefCallback } from "react";
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
	/**
	 * 面板根节点的 ref。
	 *
	 * 拖宽度时宿主直接往它写 `style.width`（不进 React，也不经过 `:root` 上的自定义属性），
	 * 见 theme-sdk 的 `SidebarModel.setPanelRef`。`width` 是 committed 值，松手时才由 React 写回。
	 */
	panelRef?: RefCallback<HTMLDivElement>;
	width: number;
}

export function SidebarPanel({
	children,
	className,
	contentClassName,
	onResize,
	onResizeEnd,
	panelRef,
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
			ref={panelRef}
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
