import type { JSX, ReactNode } from "react";
import { cn } from "@vetta/ui";

export interface PetBubbleStylePreviewViewProps {
	readonly description: string;
	readonly disabled: boolean;
	readonly label: string;
	readonly onSelect: () => void;
	readonly preview: ReactNode;
	readonly selected: boolean;
}

export function PetBubbleStylePreviewView({
	description,
	disabled,
	label,
	onSelect,
	preview,
	selected,
}: PetBubbleStylePreviewViewProps): JSX.Element {
	return (
		<button
			aria-label={label}
			aria-pressed={selected}
			className={cn(
				"overflow-hidden rounded-lg border border-border bg-card text-left transition-colors",
				"hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:border-ring",
				"disabled:cursor-not-allowed disabled:opacity-60",
				selected && "border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/30",
			)}
			disabled={disabled}
			onClick={onSelect}
			type="button"
		>
			<div className="flex min-h-32 items-center justify-center overflow-hidden bg-muted px-8 py-10">
				{preview}
			</div>
			<div className="border-t border-border px-3 py-2">
				<div className="truncate text-[12px] font-medium text-foreground">{label}</div>
				<div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{description}</div>
			</div>
		</button>
	);
}
