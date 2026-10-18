import { useId, useState, type JSX, type ReactNode } from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

export interface CompactionStepViewProps {
	readonly status: "running" | "success" | "error" | "skipped";
	/** Row title, e.g. "Compacting context…" / "Context compacted". */
	readonly label: string;
	/** Secondary text after the title, e.g. the context size before compaction. */
	readonly detail?: string;
	/** The summary that replaced the earlier conversation; the row opens to show it. */
	readonly summary?: string;
	/**
	 * 摘要正文的渲染器。宿主传入时用 Markdown 等富文本渲染，缺省按纯文本展示——
	 * 主题包不认识宿主的 Markdown 管线，只提供注入点。
	 */
	readonly renderSummary?: (summary: string) => ReactNode;
	readonly expanded?: boolean;
	readonly onToggle?: () => void;
	readonly exportMode?: boolean;
}

const STATUS_ICON: Record<CompactionStepViewProps["status"], string> = {
	running: "icon-[mdi--compress] animate-pulse text-primary/80",
	success: "icon-[mdi--compress] text-primary",
	error: "icon-[solar--danger-circle-linear] text-destructive/70",
	skipped: "icon-[mdi--skip-next-circle-outline] text-muted-foreground/60",
};

/**
 * Automatic context compaction as a step of the reply: same row rhythm as a
 * tool step, set apart by its icon and accent so it never reads as agent work.
 *
 * During streaming (status === "running"), the summary panel auto-expands so
 * the user can follow the summary being generated in real time at the bottom
 * of the conversation.
 */
export function CompactionStepView({
	status,
	label,
	detail,
	summary,
	expanded: expandedProp,
	onToggle,
	exportMode = false,
	renderSummary,
}: CompactionStepViewProps): JSX.Element {
	const [uncontrolled, setUncontrolled] = useState(false);
	const expanded = expandedProp ?? uncontrolled;
	const generatedId = useId();
	const panelId = exportMode ? `export-compaction-step-${generatedId}` : undefined;
	const hasSummary = Boolean(summary?.trim());
	// Auto-expand while streaming so the user can follow the summary in real time.
	const autoExpand = status === "running" && hasSummary;
	const open = hasSummary && (autoExpand || expanded || exportMode);
	return (
		<div className="compaction-step min-w-0 w-full" data-compaction-step={status}>
			<button
				type="button"
				disabled={!hasSummary}
				aria-expanded={open}
				data-export-toggle={hasSummary ? panelId : undefined}
				onClick={() => (onToggle ? onToggle() : setUncontrolled((value) => !value))}
				className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors enabled:hover:bg-primary/10"
			>
				<span className={`h-3.5 w-3.5 shrink-0 ${STATUS_ICON[status]}`} aria-hidden="true" />
				<span
					className={`min-w-0 truncate text-[0.8125rem] ${
						status === "running"
							? "tool-call-shimmer-text"
							: status === "error"
								? "text-destructive/80"
								: status === "skipped"
									? "text-muted-foreground/70"
									: "text-primary"
					}`}
				>
					{label}
				</span>
				{detail ? (
					<span className="shrink-0 text-[0.75rem] text-muted-foreground/50 tabular-nums">{detail}</span>
				) : null}
				{hasSummary ? (
					<span
						className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
						aria-hidden="true"
					/>
				) : null}
			</button>
			{hasSummary || status === "running" ? (
				<CollapsePanel open={open} id={panelId} exportPanel={exportMode} hidden={exportMode && !expanded}>
					<div className="ml-4 border-primary/25 border-l pb-1 pl-3">
						<div className="compaction-summary max-h-72 overflow-y-auto break-words py-1 text-muted-foreground/80">
							{summary === undefined ? null : renderSummary ? (
								renderSummary(summary)
							) : (
								<div className="whitespace-pre-wrap">{summary}</div>
							)}
						</div>
					</div>
				</CollapsePanel>
			) : null}
		</div>
	);
}
