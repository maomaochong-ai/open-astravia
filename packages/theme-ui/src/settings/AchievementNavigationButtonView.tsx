import type { JSX } from "react";
import { Button } from "@vetta-org/ui";
import { cn } from "@vetta-org/ui";

export interface AchievementNavigationAssets {
	readonly activeBackground: string;
	readonly disabledBackground: string;
	readonly activeArrow: string;
	readonly disabledArrow: string;
}

export interface AchievementNavigationButtonViewProps {
	readonly disabled: boolean;
	readonly direction: "previous" | "next";
	readonly label: string;
	readonly onClick: () => void;
	readonly assets: AchievementNavigationAssets;
}

export function AchievementNavigationButtonView({
	disabled,
	direction,
	label,
	onClick,
	assets,
}: AchievementNavigationButtonViewProps): JSX.Element {
	const previous = direction === "previous";

	return (
		<Button
			variant="ghost"
			disabled={disabled}
			aria-label={label}
			title={label}
			className={cn(
				"absolute top-1/2 z-30 h-[120px] w-[60px] rounded-none border-0 bg-transparent p-0 hover:bg-transparent disabled:opacity-100",
				previous ? "left-16" : "right-16",
			)}
			style={{
				transform: "translateY(-50%)",
				pointerEvents: "auto",
				cursor: disabled ? "default" : "pointer",
			}}
			onClick={onClick}
		>
			<img
				aria-hidden="true"
				alt=""
				draggable={false}
				src={assets.activeBackground}
				className={cn(
					"pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-150",
					disabled ? "opacity-0" : "opacity-100",
				)}
			/>
			<img
				aria-hidden="true"
				alt=""
				draggable={false}
				src={assets.disabledBackground}
				className={cn(
					"pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-150",
					disabled ? "opacity-100" : "opacity-0",
				)}
			/>
			<img
				aria-hidden="true"
				alt=""
				draggable={false}
				src={assets.activeArrow}
				className={cn(
					"pointer-events-none relative z-10 w-10 object-contain transition-opacity duration-150",
					previous && "rotate-180",
					disabled ? "opacity-0" : "opacity-100",
				)}
			/>
			<img
				aria-hidden="true"
				alt=""
				draggable={false}
				src={assets.disabledArrow}
				className={cn(
					"pointer-events-none absolute left-1/2 top-1/2 z-10 w-10 -translate-x-1/2 -translate-y-1/2 object-contain transition-opacity duration-150",
					previous && "rotate-180",
					disabled ? "opacity-100" : "opacity-0",
				)}
			/>
		</Button>
	);
}
