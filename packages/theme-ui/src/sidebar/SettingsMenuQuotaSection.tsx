import type { JSX } from "react";
import { cn } from "@vetta/ui";
import { SettingsMenuDivider } from "./SettingsMenuDivider";

export interface SettingsMenuQuotaSectionProps {
	fiveHourRemainingPercent: number;
	/** Fully resolved countdown text from host. */
	resetCountdown: string;
	quotaLabel: string;
}

export function SettingsMenuQuotaSection({
	fiveHourRemainingPercent,
	resetCountdown,
	quotaLabel,
}: SettingsMenuQuotaSectionProps): JSX.Element {
	return (
		<div>
			<SettingsMenuDivider />
			<div className="mx-2 my-1.5 rounded-md bg-accent/50 px-2 py-1.5">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5">
						<span className="icon-[solar--hourglass-linear] h-3.5 w-3.5 text-muted-foreground" />
						<span className="text-[11px] text-muted-foreground">{quotaLabel}</span>
					</div>
					<span
						className={cn(
							"text-[11px] font-semibold tabular-nums",
							fiveHourRemainingPercent <= 0 ? "text-destructive" : "text-foreground",
						)}
					>
						{fiveHourRemainingPercent}%
					</span>
				</div>
				<div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border">
					<div
						className="h-full rounded-full bg-primary/70 transition-all"
						style={{ width: `${fiveHourRemainingPercent}%` }}
					/>
				</div>
				<div className="mt-1 text-[10px] text-muted-foreground">{resetCountdown}</div>
			</div>
		</div>
	);
}
