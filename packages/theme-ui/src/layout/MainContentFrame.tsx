import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { useThemeComponent } from "@astravia/theme-sdk";
import { cn } from "@astravia/ui";

export interface MainContentFrameProps extends ComponentPropsWithoutRef<"main"> {
	children: ReactNode;
	contentClassName?: string;
	header: ReactNode;
	/**
	 * Float the header over the content instead of stacking above it. The
	 * content then spans the full frame height and its top slides under the
	 * (transparent) header strip — used by immersive full-page surfaces whose
	 * own hero starts at the very top. Window drag region and header controls
	 * keep working: the strip stays on top with pointer events.
	 */
	headerOverlay?: boolean;
}

export function MainContentFrame({
	children,
	className,
	contentClassName,
	header,
	headerOverlay = false,
	...props
}: MainContentFrameProps): JSX.Element {
	const ThemedMainContentBackground = useThemeComponent(
		"app.mainContentBackground",
		EmptyMainContentBackground,
	);

	return (
		<main
			className={cn(
				"relative flex min-h-0 min-w-[320px] flex-1 flex-col overflow-visible bg-transparent",
				// headerOverlay（immersive）时内容必须顶到窗口边缘：AppFrame 的内容区带
				// p-2 内边距，不抵消的话沉浸式页面顶部和右侧会各漏一条背景缝。
				headerOverlay && "-mt-2 -mr-2",
				className,
			)}
			data-header-overlay={headerOverlay ? "true" : undefined}
			{...props}
		>
			<ThemedMainContentBackground />
			<div
				className={cn("shrink-0", headerOverlay ? "absolute inset-x-0 top-0 z-[2]" : "relative z-[1]")}
			>
				{header}
			</div>
			<div className={cn("relative z-[1] flex min-h-0 flex-1 overflow-visible", contentClassName)}>
				{children}
			</div>
		</main>
	);
}

function EmptyMainContentBackground(): null {
	return null;
}
