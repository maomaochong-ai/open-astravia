import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { useThemeComponent } from "@vetta/theme-sdk";
import { cn } from "@vetta/ui";

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
				className,
			)}
			data-header-overlay={headerOverlay ? "true" : undefined}
			{...props}
		>
			<ThemedMainContentBackground />
			<div className={cn("z-[2] shrink-0", headerOverlay ? "absolute inset-x-0 top-0" : "relative z-[1]")}>
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
