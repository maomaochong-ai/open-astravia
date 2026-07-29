import type { JSX } from "react";

export interface UpdateCheckerViewLabels {
	readonly check: string;
	readonly checking: string;
	readonly checkingBtn: string;
	readonly currentVersion: (version: string) => string;
	readonly download: string;
	readonly downloading: (progress: number) => string;
	readonly idle: (version: string) => string;
	readonly newVersion: (version: string) => string;
	readonly restart: string;
}

export type UpdateCheckerPhase =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "ready"
	| "installing"
	| "error";

export interface UpdateCheckerViewProps {
	readonly checking: boolean;
	readonly currentVersion: string;
	readonly labels: UpdateCheckerViewLabels;
	readonly latestVersion?: string;
	readonly onCheck: () => void;
	readonly onPrimary: () => void;
	readonly phase: UpdateCheckerPhase;
	readonly progress?: number;
	readonly releaseNote?: string;
	readonly statusText: string;
}

/** Matches host Button secondary/primary sizes without importing host UI. */
const buttonBase =
	"group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50";

export function UpdateCheckerView({
	checking,
	currentVersion,
	labels,
	latestVersion,
	onCheck,
	onPrimary,
	phase,
	progress,
	releaseNote,
	statusText,
}: UpdateCheckerViewProps): JSX.Element {
	const showStatus = phase === "idle" || phase === "error" || phase === "checking";
	const statusColor = phase === "error" ? "text-red-500" : "text-muted-foreground";

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				{showStatus && statusText ? (
					<span className={`min-w-0 truncate text-[12px] ${statusColor}`}>{statusText}</span>
				) : (
					<span />
				)}
				<button
					type="button"
					onClick={onCheck}
					disabled={checking}
					className={`${buttonBase} h-8 shrink-0 gap-1.5 rounded-lg border-border bg-secondary px-3 text-[12px] text-secondary-foreground hover:bg-secondary/80`}
				>
					<span className={`icon-[mdi--refresh] h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
					{checking ? labels.checkingBtn : labels.check}
				</button>
			</div>

			{(phase === "available" || phase === "downloading" || phase === "ready") && (
				<div className="space-y-2 rounded-lg border border-border bg-secondary p-3">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<span className="text-[13px] font-medium text-foreground">
								{labels.newVersion(latestVersion ?? "")}
							</span>
							<span className="ml-2 text-[12px] text-muted-foreground">
								{labels.currentVersion(currentVersion)}
							</span>
						</div>
						{phase === "available" && (
							<button
								type="button"
								onClick={onPrimary}
								className={`${buttonBase} h-7 rounded-lg bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90`}
							>
								{labels.download}
							</button>
						)}
						{phase === "downloading" && (
							<span className="shrink-0 text-[12px] text-muted-foreground">
								{labels.downloading(Math.round((progress ?? 0) * 100))}
							</span>
						)}
						{phase === "ready" && (
							<button
								type="button"
								onClick={onPrimary}
								className={`${buttonBase} h-7 rounded-lg bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90`}
							>
								{labels.restart}
							</button>
						)}
					</div>
					{releaseNote && (
						<p className="whitespace-pre-wrap text-[12px] text-muted-foreground">{releaseNote}</p>
					)}
				</div>
			)}
		</div>
	);
}
