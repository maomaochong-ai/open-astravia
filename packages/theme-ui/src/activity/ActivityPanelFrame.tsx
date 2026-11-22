import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { cn } from "@astravia-org/ui/utils";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface ActivityPanelFrameProps extends ComponentPropsWithoutRef<"div"> {
	children: ReactNode;
	contentClassName?: string;
	/**
	 * 面板左上角改用小圆角。
	 *
	 * 标签栏与面板左边框留有间距时，这个角会露在第一个标签左侧；原来 12px 的大圆角
	 * 在这种矮行高下显得过重，换成 6px，与标签自身的 `rounded-t-md` 同档。
	 * 没有标签栏（如铺满态）时仍用 12px。
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
				flushTopLeft ? "rounded-tl-md" : "rounded-tl-xl",
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
