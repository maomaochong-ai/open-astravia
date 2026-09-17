import type { JSX, ReactNode } from "react";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import { cn } from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { ResizeHandle } from "../layout/ResizeHandle";

/**
 * 拖宽度时的实时通道。
 *
 * 拖拽途中宿主只更新这个 CSS 变量（不进 React）：宽度一旦进 state，每一帧都要重渲染整条
 * 侧边栏、根布局与当前页面，实测一次快拖 26 帧卡帧、6-11 个 long task。committed 值仍由
 * `width` 兜底，变量缺失（其他宿主、测试环境）时行为不变。
 */
export const SIDEBAR_LIVE_WIDTH_VAR = "--sidebar-live-width";

/** 面板与左栏占位共用这一段：两者必须逐帧一致，否则拖拽时会错开。 */
export function sidebarWidthValue(width: number): string {
	return `var(${SIDEBAR_LIVE_WIDTH_VAR}, ${width}px)`;
}

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
			style={{ width: sidebarWidthValue(width) }}
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
