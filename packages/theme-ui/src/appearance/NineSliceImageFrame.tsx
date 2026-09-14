import { memo, type ComponentPropsWithoutRef, type JSX, type ReactNode } from "react";
import type { NineSliceImageFrameDecoration } from "@vetta-org/theme-sdk/appearance";
import { cn } from "@vetta-org/ui";

export interface NineSliceImageFrameProps extends ComponentPropsWithoutRef<"div"> {
	children: ReactNode;
	contentClassName?: string;
	decoration?: NineSliceImageFrameDecoration;
	imageUrl?: string;
}

export const NineSliceImageDecoration = memo(function NineSliceImageDecoration({
	className,
	decoration,
	imageUrl,
}: {
	className?: string;
	decoration: NineSliceImageFrameDecoration;
	imageUrl: string;
}): JSX.Element {
	return (
		<span
			aria-hidden="true"
			// -inset-px：四周外扩 1px，盖住 DPR/非整数宽下的子像素发丝缝
			// translateZ(0)：独立合成层，减轻 border-image 切片接缝闪线
			className={cn(
				"pointer-events-none absolute -inset-px [backface-visibility:hidden] [transform:translateZ(0)]",
				className,
			)}
			style={{
				borderImageOutset: decoration.outset,
				borderImageRepeat: decoration.repeat ?? "stretch",
				borderImageSlice: `${decoration.slice} fill`,
				borderImageSource: `url("${imageUrl}")`,
				borderImageWidth: decoration.borderWidth,
				borderStyle: "solid",
				borderWidth: decoration.borderWidth,
			}}
		/>
	);
});

export function NineSliceImageFrame({
	children,
	className,
	contentClassName,
	decoration,
	imageUrl,
	...props
}: NineSliceImageFrameProps): JSX.Element {
	return (
		<div
			className={cn("relative", className)}
			{...props}
		>
			{imageUrl && decoration ? (
				<NineSliceImageDecoration
					decoration={decoration}
					imageUrl={imageUrl}
				/>
			) : null}
			<div className={cn("relative", contentClassName)}>{children}</div>
		</div>
	);
}
