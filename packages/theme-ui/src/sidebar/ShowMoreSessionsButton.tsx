import type { JSX } from "react";
import { cn } from "@vetta-org/ui";

export interface ShowMoreSessionsButtonLabels {
	/** Fully resolved collapse label. */
	collapse: string;
	/** Fully resolved expand label (host interpolates count). */
	expand: string;
}

export interface ShowMoreSessionsButtonProps {
	labels: ShowMoreSessionsButtonLabels;
	onClick: () => void;
	showAll: boolean;
}

export function ShowMoreSessionsButton({
	labels,
	onClick,
	showAll,
}: ShowMoreSessionsButtonProps): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-center gap-1 rounded-lg px-2.5 py-[6px] pl-[36px] text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
		>
			<span
				className={cn(
					showAll ? "icon-[solar--alt-arrow-up-linear]" : "icon-[solar--alt-arrow-down-linear]",
					"h-3.5 w-3.5 shrink-0",
				)}
			/>
			{showAll ? labels.collapse : labels.expand}
		</button>
	);
}
