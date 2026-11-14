import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { cn } from "@astravia-org/ui/utils";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface ActivityPanelFrameProps extends ComponentPropsWithoutRef<"div"> {
	children: ReactNode;
	contentClassName?: string;
}

export function ActivityPanelFrame({
	children,
	className,
	contentClassName,
	...props
}: ActivityPanelFrameProps): JSX.Element {
	return (
		<div
			className={cn(
				// 只留左上圆角，以及左边、上边的描边；右边和底边贴内容区，不再画线和圆角。
				"relative z-10 flex min-h-0 flex-1 flex-col overflow-visible rounded-tl-xl border-l border-t border-border bg-muted",
				className,
			)}
			data-theme-surface-root="activity.panel"
			{...props}
		>
			<ThemeSurface slot="activity.panel" />
			<div
				className={cn(
					"relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]",
					contentClassName,
				)}
			>
				{children}
			</div>
		</div>
	);
}
