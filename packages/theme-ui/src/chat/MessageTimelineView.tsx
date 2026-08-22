import { forwardRef, type ButtonHTMLAttributes, type JSX, type ReactNode } from "react";

export interface MessageTimelineRailViewProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	activeTurn: number;
	label: string;
	totalTurns: number;
}

export const MessageTimelineRailView = forwardRef<HTMLButtonElement, MessageTimelineRailViewProps>(
	function MessageTimelineRailView({ activeTurn, className, label, totalTurns, ...buttonProps }, ref) {
		const progress = totalTurns <= 1 ? 0 : (activeTurn - 1) / (totalTurns - 1);
		return (
			<button
				{...buttonProps}
				ref={ref}
				type="button"
				aria-label={label}
				title={label}
				className={`group flex h-28 w-8 items-center justify-center rounded-lg opacity-35 transition-opacity hover:bg-muted/40 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring ${className ?? ""}`}
			>
				<span className="relative h-20 w-px rounded-full bg-border/70" aria-hidden>
					<span
						className="absolute -left-1 h-2 w-2 rounded-full border border-primary/40 bg-primary transition-[top] duration-200"
						style={{ top: `calc(${progress * 100}% - 4px)` }}
					/>
				</span>
			</button>
		);
	},
);

export function MessageTimelinePanelView({
	countLabel,
	emptyLabel,
	searchInput,
	timeline,
	title,
}: {
	countLabel: string;
	emptyLabel: string;
	searchInput: ReactNode;
	timeline: ReactNode;
	title: string;
}): JSX.Element {
	return (
		<div className="flex flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground">
			<div className="border-b border-border/50 px-3.5 pt-3 pb-2.5">
				<div className="mb-2 flex items-center justify-between gap-3">
					<h2 className="text-[13px] font-semibold text-foreground/85">{title}</h2>
					<span className="text-[11px] text-muted-foreground/55">{countLabel}</span>
				</div>
				{searchInput}
			</div>
			<div className="h-80 min-h-0">{timeline || <div className="p-4 text-[12px] text-muted-foreground">{emptyLabel}</div>}</div>
		</div>
	);
}

export function MessageTimelineEntryView({
	active,
	preview,
	roleLabel,
	turnLabel,
	onClick,
}: {
	active: boolean;
	preview: string;
	roleLabel: string;
	turnLabel: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={active ? "location" : undefined}
			className={`group relative flex w-full gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none ${active ? "bg-primary/10" : ""}`}
		>
			<span className="relative flex w-3 shrink-0 justify-center" aria-hidden>
				<span className="absolute inset-y-0 w-px bg-border/60" />
				<span
					className={`relative mt-1.5 h-2 w-2 rounded-full border ${active ? "border-primary bg-primary" : "border-border bg-popover group-hover:border-primary/50"}`}
				/>
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/55">
					<span>{turnLabel}</span>
					<span aria-hidden>·</span>
					<span>{roleLabel}</span>
				</span>
				<span className="mt-0.5 block truncate text-[12px] text-foreground/75">{preview}</span>
			</span>
		</button>
	);
}
