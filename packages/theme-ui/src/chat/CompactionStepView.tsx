import { useId, useState, type JSX } from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

export interface CompactionStepViewProps {
	readonly status: "running" | "success" | "error";
	/** Row title, e.g. "Compacting context…" / "Context compacted". */
	readonly label: string;
	/** Secondary text after the title, e.g. the context size before compaction. */
	readonly detail?: string;
	/** The summary that replaced the earlier conversation; the row opens to show it. */
	readonly summary?: string;
	readonly expanded?: boolean;
	readonly onToggle?: () => void;
	readonly exportMode?: boolean;
}

const STATUS_ICON: Record<CompactionStepViewProps["status"], string> = {
	running: "icon-[mdi--compress] animate-pulse text-sky-500/80 dark:text-sky-400/80",
	success: "icon-[mdi--compress] text-sky-500 dark:text-sky-400",
	error: "icon-[solar--danger-circle-linear] text-destructive/70",
};

/**
 * Automatic context compaction as a step of the reply: same row rhythm as a
 * tool step, set apart by its icon and accent so it never reads as agent work.
 */
export function CompactionStepView({
	status,
	label,
	detail,
	summary,
	expanded: expandedProp,
	onToggle,
	exportMode = false,
}: CompactionStepViewProps): JSX.Element {
	const [uncontrolled, setUncontrolled] = useState(false);
	const expanded = expandedProp ?? uncontrolled;
	const generatedId = useId();
	const panelId = exportMode ? `export-compaction-step-${generatedId}` : undefined;
	const hasSummary = Boolean(summary?.trim());
	const open = hasSummary && (expanded || exportMode);
	return (
		<div className="min-w-0 w-full" data-compaction-step={status}>
			<button
				type="button"
				disabled={!hasSummary}
				aria-expanded={open}
				data-export-toggle={hasSummary ? panelId : undefined}
				onClick={() => (onToggle ? onToggle() : setUncontrolled((value) => !value))}
				className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors enabled:hover:bg-sky-500/10"
			>
				<span className={`h-3.5 w-3.5 shrink-0 ${STATUS_ICON[status]}`} aria-hidden="true" />
				<span
					className={`min-w-0 truncate text-[13px] ${
						status === "running"
							? "tool-call-shimmer-text"
							: status === "error"
								? "text-destructive/80"
								: "text-sky-600/90 dark:text-sky-300/85"
					}`}
				>
					{label}
				</span>
				{detail ? (
					<span className="shrink-0 text-[12px] text-muted-foreground/50 tabular-nums">{detail}</span>
				) : null}
				{hasSummary ? (
					<span
						className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
						aria-hidden="true"
					/>
				) : null}
			</button>
			{hasSummary ? (
				<CollapsePanel open={open} id={panelId} exportPanel={exportMode} hidden={exportMode && !expanded}>
					<div className="ml-4 border-sky-500/25 border-l pb-1 pl-3">
						<div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words py-1 text-[12px] leading-relaxed text-muted-foreground/80">
							{summary}
						</div>
					</div>
				</CollapsePanel>
			) : null}
		</div>
	);
}
