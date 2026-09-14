import { memo, type ComponentPropsWithoutRef, type JSX, type ReactNode } from "react";
import type { BackgroundImageFrameDecoration } from "@vetta-org/theme-sdk/appearance";
import { cn } from "@vetta-org/ui";

export interface BackgroundImageFrameProps extends ComponentPropsWithoutRef<"div"> {
	children: ReactNode;
	contentClassName?: string;
	decoration?: BackgroundImageFrameDecoration;
	imageUrl?: string;
}

export const BackgroundImageDecoration = memo(function BackgroundImageDecoration({
	className,
	decoration,
	imageUrl,
}: {
	className?: string;
	decoration?: BackgroundImageFrameDecoration;
	imageUrl: string;
}): JSX.Element {
	return (
		<span
			aria-hidden="true"
			className={cn("pointer-events-none absolute inset-0", className)}
			style={{
				backgroundImage: `url("${imageUrl}")`,
				backgroundPosition: decoration?.position ?? "center",
				backgroundRepeat: decoration?.repeat ?? "no-repeat",
				backgroundSize: decoration?.size ?? "cover",
			}}
		/>
	);
});

export function BackgroundImageFrame({
	children,
	className,
	contentClassName,
	decoration,
	imageUrl,
	...props
}: BackgroundImageFrameProps): JSX.Element {
	return (
		<div
			className={cn("relative", className)}
			{...props}
		>
			{imageUrl ? (
				<BackgroundImageDecoration
					decoration={decoration}
					imageUrl={imageUrl}
				/>
			) : null}
			<div className={cn("relative", contentClassName)}>{children}</div>
		</div>
	);
}
