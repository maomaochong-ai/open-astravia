import type { ReactNode } from "react";
import type { ChangeEntry } from "../git/types";
import { GitFileTree } from "./GitFileTree";
import { GitFlatList } from "./GitFlatList";
import { ChevronIcon } from "./icons";

/** Height budget for one section's body so three sections share the column. */
const ROW_HEIGHT = 24;
const MIN_BODY = ROW_HEIGHT * 2;
const MAX_BODY = ROW_HEIGHT * 12;

/**
 * One labelled, collapsible section of the change list (conflicts / staged /
 * unstaged) wrapping either view mode.
 *
 * Each section gets its own tree model, so selection is per-section by
 * construction; the parent keeps at most one section selected at a time and
 * batch actions therefore always address a single, unambiguous side.
 */
export function ChangeSectionList({
	title,
	entries,
	viewMode,
	collapsed,
	onToggleCollapsed,
	selectedPaths,
	onSelectionChange,
	actions,
	tone,
}: {
	title: string;
	entries: readonly ChangeEntry[];
	viewMode: "tree" | "flat";
	collapsed: boolean;
	onToggleCollapsed: () => void;
	selectedPaths: readonly string[];
	onSelectionChange: (paths: string[], added: string | null) => void;
	/** Section-level buttons, revealed on hover of the header. */
	actions?: ReactNode;
	tone?: "danger";
}): JSX.Element | null {
	if (entries.length === 0) return null;
	// The tree renders into a fixed-height host, so give it a share of the column
	// that grows with its content instead of a hard split.
	const bodyHeight = Math.min(MAX_BODY, Math.max(MIN_BODY, entries.length * ROW_HEIGHT + 4));

	return (
		<div className="flex shrink-0 flex-col border-b border-border/60 last:border-b-0">
			<div className="group flex h-6 items-center gap-1 px-1.5">
				<button
					type="button"
					onClick={onToggleCollapsed}
					className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
				>
					<ChevronIcon className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
					<span className={`truncate ${tone === "danger" ? "text-orange-500" : ""}`}>{title}</span>
					<span className="shrink-0 tabular-nums opacity-70">{entries.length}</span>
				</button>
				{actions && <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">{actions}</div>}
			</div>
			{!collapsed && (
				<div className="min-h-0 overflow-hidden" style={viewMode === "tree" ? { height: bodyHeight } : undefined}>
					{viewMode === "tree" ? (
						<GitFileTree entries={entries} selectedPaths={selectedPaths} onSelectionChange={onSelectionChange} />
					) : (
						<GitFlatList entries={entries} selectedPaths={selectedPaths} onSelectionChange={onSelectionChange} />
					)}
				</div>
			)}
		</div>
	);
}
