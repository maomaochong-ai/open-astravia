import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { isMac } from "../utils/platform";
import { cn } from "@vetta-org/ui";

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
				!macChrome && "h-8",
				className,
			)}
			data-theme-surface-root="app.pageHeader"
			style={{
				// Same gutter as desktop SidebarTopBar / macOS traffic-light reserve.
				paddingLeft: reserveMacTrafficLights && macChrome && triggerVisible ? 78 : 12,
				paddingRight: reserveMacTrafficLights && macChrome ? 12 : 0,
				marginBottom: macChrome ? 0 : 10,
				...style,
			}}
			{...props}
		>
			<ThemeSurface slot="app.pageHeader" />
			<div className={cn("relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2", contentClassName)}>
				{children}
			</div>
		</div>
	);
}
