import type { JSX, MouseEvent } from "react";
import { Button } from "@vetta-org/ui";

export interface BatchTaskActionButtonViewProps {
	readonly disabled?: boolean;
	readonly icon: string;
	readonly onClick: () => void;
	readonly title: string;
	readonly variant?: "danger";
}

export function ActionButtonView({
	disabled,
	icon,
	onClick,
	title,
	variant,
}: BatchTaskActionButtonViewProps): JSX.Element {
	return (
		<Button
			type="button"
			disabled={disabled}
			onClick={onClick}
			title={title}
			variant="ghost"
			size="icon-sm"
			className={
				variant === "danger"
					? "text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
					: "text-muted-foreground/60 hover:bg-primary/10 hover:text-primary"
			}
		>
			<span className={`${icon} text-[14px]`} />
		</Button>
	);
}

export interface BatchTaskOverlayActionButtonViewProps {
	readonly icon: string;
	readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly title: string;
	readonly variant?: "danger";
}

export function OverlayActionButtonView({
	icon,
	onClick,
	title,
	variant,
}: BatchTaskOverlayActionButtonViewProps): JSX.Element {
	return (
		<Button
			type="button"
			onClick={onClick}
			title={title}
			variant="ghost"
			size="icon-sm"
			className={`rounded-full bg-card/90 ring-1 ring-inset ring-border/50 backdrop-blur-sm ${
				variant === "danger"
					? "text-muted-foreground hover:bg-destructive/15 hover:text-destructive hover:ring-destructive/40"
					: "text-muted-foreground hover:bg-primary/15 hover:text-primary hover:ring-primary/40"
			}`}
		>
			<span className={`${icon} text-[13px]`} />
		</Button>
	);
}
