import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { cn } from "@astravia-org/ui/utils";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface ActivityPanelFrameProps extends ComponentPropsWithoutRef<"div"> {
	children: ReactNode;
	contentClassName?: string;
	/**
	 * 左上角是否切直角。
	 *
	 * 标签栏在面板上方时，第一个标签的左沿压在面板左边框上、自己占住左上角；
	 * 面板再画 12px 圆角，两个不同半径的角就会在同一个点上打架。
	 * 没有标签栏（如铺满态）时仍保留圆角。
	 */
	flushTopLeft?: boolean;
}

export function ActivityPanelFrame({
	children,
	className,
	contentClassName,
	flushTopLeft = false,
	...props
}: ActivityPanelFrameProps): JSX.Element {
	return (
		<div
			className={cn(
				// 只留左边、上边的描边；右边和底边贴内容区。左上角看有无标签占位。
				"relative z-10 flex min-h-0 flex-1 flex-col overflow-visible border-l border-t border-border bg-muted",
				flushTopLeft ? "rounded-tl-none" : "rounded-tl-xl",
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
