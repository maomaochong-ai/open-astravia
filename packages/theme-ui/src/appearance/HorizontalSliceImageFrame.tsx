import { memo, type ComponentPropsWithoutRef, type JSX, type ReactNode } from "react";
import type { HorizontalSliceImageFrameDecoration } from "@vetta-org/theme-sdk/appearance";
import { cn } from "@vetta-org/ui";

export interface HorizontalSliceImageFrameProps extends ComponentPropsWithoutRef<"div"> {
	children: ReactNode;
	contentClassName?: string;
	decoration?: HorizontalSliceImageFrameDecoration;
	imageUrl?: string;
}

export const HorizontalSliceImageDecoration = memo(function HorizontalSliceImageDecoration({
	className,
	decoration,
	imageUrl,
}: {
	className?: string;
	decoration: HorizontalSliceImageFrameDecoration;
	imageUrl: string;
}): JSX.Element {
	const centerWidth = `calc(100% + ${decoration.leftWidth} + ${decoration.rightWidth})`;

	return (
		<span
			aria-hidden="true"
			className={cn("pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2", className)}
			style={{
				height: decoration.height ?? "100%",
			}}
		>
			<span
				className="absolute bottom-0 left-0 top-0 overflow-hidden"
				style={{ width: decoration.leftWidth }}
			>
				<img
					alt=""
					className="absolute left-0 top-0 h-full max-w-none select-none object-contain"
					draggable={false}
					src={imageUrl}
				/>
			</span>
			<span
				className="absolute bottom-0 top-0 overflow-hidden"
				style={{
					left: decoration.leftWidth,
					right: decoration.rightWidth,
				}}
			>
				<img
					alt=""
					className="absolute top-0 h-full max-w-none select-none object-fill"
					draggable={false}
					src={imageUrl}
					style={{
						left: `calc(-1 * ${decoration.leftWidth})`,
						width: centerWidth,
					}}
				/>
			</span>
			<span
				className="absolute bottom-0 right-0 top-0 overflow-hidden"
				style={{ width: decoration.rightWidth }}
			>
				<img
					alt=""
					className="absolute right-0 top-0 h-full max-w-none select-none object-contain"
					draggable={false}
					src={imageUrl}
				/>
			</span>
		</span>
	);
});

export function HorizontalSliceImageFrame({
	children,
	className,
	contentClassName,
	decoration,
	imageUrl,
	...props
}: HorizontalSliceImageFrameProps): JSX.Element {
	return (
		<div
			className={cn("relative", className)}
			{...props}
		>
			{imageUrl && decoration ? (
				<HorizontalSliceImageDecoration
					decoration={decoration}
					imageUrl={imageUrl}
				/>
			) : null}
			<div className={cn("relative", contentClassName)}>{children}</div>
		</div>
	);
}
