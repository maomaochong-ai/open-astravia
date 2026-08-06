import type { JSX, MouseEvent } from "react";
import type { BatchTaskStatus, BatchTaskTone } from "./types";

export const TASK_COLLAPSE_THRESHOLD = 9;

export const STATUS_TONE: Record<BatchTaskStatus, BatchTaskTone> = {
	completed: {
		dot: "bg-emerald-500",
		ring: "ring-emerald-500/25",
		text: "text-emerald-400",
		bg: "bg-emerald-500/10",
	},
	running: {
		dot: "bg-emerald-500",
		ring: "ring-emerald-500/30",
		text: "text-emerald-400",
		bg: "bg-emerald-500/10",
	},
	failed: {
		dot: "bg-destructive",
		ring: "ring-destructive/30",
		text: "text-destructive",
		bg: "bg-destructive/10",
	},
	paused: {
		dot: "bg-primary",
		ring: "ring-primary/30",
		text: "text-primary",
		bg: "bg-primary/10",
	},
	pending: {
		dot: "bg-muted-foreground/40",
		ring: "ring-border/50",
		text: "text-muted-foreground/70",
		bg: "bg-muted/40",
	},
};

export const QUEUED_TONE: BatchTaskTone = {
	dot: "bg-amber-500",
	ring: "ring-amber-500/30",
	text: "text-amber-400",
	bg: "bg-amber-500/10",
};

export function OverlayActionButton({
	icon,
	onClick,
	title,
	variant,
}: {
	icon: string;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	title: string;
	variant?: "danger";
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-card/90 ring-1 ring-inset ring-border/50 backdrop-blur-sm ${
				variant === "danger"
					? "text-muted-foreground hover:bg-destructive/15 hover:text-destructive hover:ring-destructive/40"
					: "text-muted-foreground hover:bg-primary/15 hover:text-primary hover:ring-primary/40"
			}`}
		>
			<span className={`${icon} text-[13px]`} />
		</button>
	);
}

export function ActionIconButton({
	disabled,
	icon,
	onClick,
	title,
	variant,
}: {
	disabled?: boolean;
	icon: string;
	onClick: () => void;
	title: string;
	variant?: "danger";
}): JSX.Element {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			title={title}
			className={`inline-flex size-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-transparent text-sm font-medium transition-all outline-none select-none focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 ${
				variant === "danger"
					? "text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
					: "text-muted-foreground/60 hover:bg-primary/10 hover:text-primary"
			}`}
		>
			<span className={`${icon} text-[14px]`} />
		</button>
	);
}
