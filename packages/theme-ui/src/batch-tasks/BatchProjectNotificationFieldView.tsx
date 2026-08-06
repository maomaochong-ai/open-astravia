import type { JSX } from "react";

export interface BatchProjectNotificationFieldViewLabels {
	readonly title: string;
	readonly description: string;
}

export interface BatchProjectNotificationFieldViewProps {
	readonly checked: boolean;
	readonly onChange: (checked: boolean) => void;
	readonly labels: BatchProjectNotificationFieldViewLabels;
}

export function BatchProjectNotificationFieldView({
	checked,
	onChange,
	labels,
}: BatchProjectNotificationFieldViewProps): JSX.Element {
	return (
		<div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2.5">
			<div className="min-w-0">
				<div className="text-sm font-medium text-foreground">{labels.title}</div>
				<div className="mt-0.5 text-xs text-muted-foreground/80">{labels.description}</div>
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				onClick={() => onChange(!checked)}
				className={`peer relative inline-flex h-[18.4px] w-[32px] shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring ${
					checked ? "bg-primary" : "bg-input"
				}`}
			>
				<span
					className={`pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform ${
						checked ? "translate-x-[calc(100%-2px)]" : "translate-x-0"
					}`}
				/>
			</button>
		</div>
	);
}
