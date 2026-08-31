import type { JSX, ReactNode } from "react";
import { useId, useState } from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

const ROW_BUTTON =
	"inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors";

export interface ProgressGroupViewProps {
	/** Agent-authored stage title, or a host-projected live activity while in progress. */
	title: string;
	/** Number of calls folded into this stage. */
	blockCount: number;
	/** Stage finished — swaps the spinner for a check and stops the shimmer. */
	done: boolean;
	exportMode?: boolean;
	/** Controlled expansion. Host owns it so the state survives list virtualization. */
	expanded?: boolean;
	onToggle?: () => void;
	/** Expanded rows: one line per call. */
	children: ReactNode;
}

/**
 * Work-mode stage group: one readable line per stage, everything the agent did
 * inside it folded away. Deliberately quieter and less technical than
 * `ToolCallGroupView`, which stays the coding-mode rendering.
 */
export function ProgressGroupView({
	title,
	blockCount,
	done,
	exportMode = false,
	expanded: expandedProp,
	onToggle,
	children,
}: ProgressGroupViewProps): JSX.Element {
	const [uncontrolled, setUncontrolled] = useState(false);
	const expanded = expandedProp ?? uncontrolled;
	const toggle = onToggle ?? ((): void => setUncontrolled(!uncontrolled));
	const generatedId = useId();
	const panelId = exportMode ? `export-progress-group-${generatedId}` : undefined;
	const open = expanded || exportMode;
	const hasRows = blockCount > 0;

	return (
		<div className="min-w-0 w-full">
			<button
				type="button"
				onClick={() => hasRows && toggle()}
				data-export-toggle={panelId}
				aria-expanded={open}
				disabled={!hasRows}
				className={`${ROW_BUTTON} enabled:hover:bg-muted/60`}
			>
				<span
					className={
						done
							? "icon-[solar--check-circle-linear] h-3.5 w-3.5 shrink-0 text-emerald-400"
							: "icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/60"
					}
				/>
				<span
					className={`min-w-0 truncate text-[13px] ${done ? "text-muted-foreground" : "tool-call-shimmer-text"}`}
				>
					{title}
				</span>
				{hasRows && (
					<span
						className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
					/>
				)}
			</button>
			<CollapsePanel
				open={open && hasRows}
				id={panelId}
				exportPanel={exportMode}
				hidden={exportMode && !expanded}
			>
				<div className="ml-4 flex flex-col gap-0.5 border-border/50 border-l pb-1 pl-3">{children}</div>
			</CollapsePanel>
		</div>
	);
}

export interface ProgressGroupRowProps {
	/** One-line, user-facing reason for this call. */
	text: string;
	status: "pending" | "success" | "error";
	/** Full coding-mode tool card, revealed on demand. */
	details?: ReactNode;
	exportMode?: boolean;
	/** Controlled expansion. Host owns it so the state survives list virtualization. */
	expanded?: boolean;
	onToggle?: () => void;
}

/** One folded call inside a stage: a sentence, plus opt-in access to the body. */
export function ProgressGroupRow({
	text,
	status,
	details,
	exportMode = false,
	expanded,
	onToggle,
}: ProgressGroupRowProps): JSX.Element {
	const [uncontrolled, setUncontrolled] = useState(false);
	const open = expanded ?? uncontrolled;
	const toggle = onToggle ?? ((): void => setUncontrolled(!uncontrolled));
	const showDetails = Boolean(details) && (open || exportMode);

	return (
		<div className="flex min-w-0 w-full flex-col gap-0.5">
			<button
				type="button"
				onClick={() => details && toggle()}
				aria-expanded={showDetails}
				disabled={!details}
				className={`${ROW_BUTTON} enabled:hover:bg-muted/50`}
			>
				<span
					className={
						status === "pending"
							? "icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/50"
							: status === "error"
								? "icon-[solar--danger-circle-linear] h-3.5 w-3.5 shrink-0 text-destructive/70"
								: "icon-[solar--check-read-linear] h-3.5 w-3.5 shrink-0 text-emerald-400"
					}
				/>
				<span className="min-w-0 truncate text-[12px] text-muted-foreground/80" title={text}>
					{text}
				</span>
				{details && (
					<span
						className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${showDetails ? "rotate-90" : ""}`}
					/>
				)}
			</button>
			<CollapsePanel open={showDetails}>
				<div className="min-w-0 pb-1 pl-6">{details}</div>
			</CollapsePanel>
		</div>
	);
}
