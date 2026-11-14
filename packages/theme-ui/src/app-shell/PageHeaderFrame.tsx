import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { isMac } from "../utils/platform";
import { cn } from "@astravia-org/ui/utils";

export interface PageHeaderFrameProps extends ComponentPropsWithoutRef<"div"> {
	children: ReactNode;
	contentClassName?: string;
	/**
	 * When true, use Mac titlebar metrics (h-11, 78px traffic-light gutter when
	 * the sidebar trigger is visible) even if the host OS is not macOS.
	 * Marketing shells that paint fake traffic lights should set this.
	 */
	forceMacChrome?: boolean;
	reserveMacTrafficLights?: boolean;
	triggerVisible?: boolean;
}

/**
 * 给红绿灯留的横向让位（屏幕 px）。红绿灯不随界面缩放，所以换算成 CSS px 时要除以缩放比；
 * `--ui-zoom` 由宿主写在 :root 上，没有时（营销页等）按 1 处理。
 */
export const TRAFFIC_LIGHT_GUTTER = "calc(78px / var(--ui-zoom, 1))";

export function PageHeaderFrame({
	children,
	className,
	contentClassName,
	forceMacChrome = false,
	reserveMacTrafficLights = true,
	style,
	triggerVisible = false,
	...props
}: PageHeaderFrameProps): JSX.Element {
	const macChrome = forceMacChrome || isMac;
	return (
		<div
			className={cn(
				"drag-region relative flex h-11 shrink-0 items-center justify-between gap-2 overflow-visible",
				// macOS：内容整体上提 2px，与红绿灯的视觉中线对齐（红绿灯位置见主进程 window-manager）。
				macChrome && "top-[-2px]",
				!macChrome && "h-8",
				className,
			)}
			data-theme-surface-root="app.pageHeader"
			style={{
				// Same gutter as desktop SidebarTopBar / macOS traffic-light reserve.
				paddingLeft: reserveMacTrafficLights && macChrome && triggerVisible ? TRAFFIC_LIGHT_GUTTER : 12,
				paddingRight: reserveMacTrafficLights && macChrome ? 12 : 0,
				marginBottom: macChrome ? 0 : 10,
				...style,
			}}
			{...props}
		>
			<ThemeSurface slot="app.pageHeader" />
			<div
				className={cn("relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2", contentClassName)}
				// 宿主实测这条内容行的垂直中线，据此摆放 macOS 红绿灯（见 renderer 的 useTitlebarAnchor）。
				data-titlebar-anchor=""
			>
				{children}
			</div>
		</div>
	);
}
