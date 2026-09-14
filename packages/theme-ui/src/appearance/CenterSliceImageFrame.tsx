import { memo, type JSX } from "react";
import { cn } from "@vetta-org/ui";

export interface CenterSliceImageFrameDecoration {
	readonly centerWidth: string;
	readonly height?: string;
}

export const CenterSliceImageDecoration = memo(function CenterSliceImageDecoration({
	className,
	decoration,
	imageUrl,
}: {
	className?: string;
	decoration: CenterSliceImageFrameDecoration;
	imageUrl: string;
}): JSX.Element {
	const sideWidth = `max(0px, calc((100% - ${decoration.centerWidth}) / 2))`;
	const stretchedImageWidth = `calc(200% + ${decoration.centerWidth})`;

	return (
		<span
			aria-hidden="true"
			className={cn("pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2", className)}
			style={{ height: decoration.height ?? "100%" }}
		>
			<span
				className="absolute bottom-0 left-0 top-0 overflow-hidden"
				style={{ width: sideWidth }}
			>
				<img
					alt=""
					className="absolute left-0 top-0 h-full max-w-none select-none object-fill"
					draggable={false}
					src={imageUrl}
					style={{ width: stretchedImageWidth }}
				/>
			</span>
			<span
				className="absolute bottom-0 left-1/2 top-0 -translate-x-1/2 overflow-hidden"
				style={{ width: decoration.centerWidth }}
			>
				<img
					alt=""
					className="absolute left-1/2 top-0 h-full max-w-none -translate-x-1/2 select-none object-contain"
					draggable={false}
					src={imageUrl}
				/>
			</span>
			<span
				className="absolute bottom-0 right-0 top-0 overflow-hidden"
				style={{ width: sideWidth }}
			>
				<img
					alt=""
					className="absolute right-0 top-0 h-full max-w-none select-none object-fill"
					draggable={false}
					src={imageUrl}
					style={{ width: stretchedImageWidth }}
				/>
			</span>
		</span>
	);
});
