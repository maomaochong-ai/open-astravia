import type { ReactNode } from "react";
import type { ChangeEntry } from "../git/types";
import type { MenuPoint } from "./ChangeMenu";
import { GitFileTree } from "./GitFileTree";
import { GitFlatList } from "./GitFlatList";
import { ChevronIcon } from "./icons";

/** Floor for a section body, so a one-file section is still usable when squeezed. */
const MIN_BODY = 48;

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
	renderMenu,
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
	/** Context-menu body for the right-clicked paths in this section. */
	renderMenu?: (paths: string[], close: () => void, point?: MenuPoint) => ReactNode;
	/** Section-level buttons, revealed on hover of the header. */
	actions?: ReactNode;
	tone?: "danger";
}): JSX.Element | null {
	if (entries.length === 0) return null;

	return (
		// Expanded sections share all the space left below the commit box, split in
		// proportion to how many files each holds; the tree scrolls internally once
		// its share is too small. A collapsed section keeps only its header.
		<div
			className={`flex flex-col border-b border-border/60 last:border-b-0 ${collapsed ? "shrink-0" : "min-h-0"}`}
			style={collapsed ? undefined : { flex: `${entries.length} 1 0`, minHeight: MIN_BODY }}
		>
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
				<div className="min-h-0 flex-1 overflow-hidden">
					{viewMode === "tree" ? (
						<GitFileTree entries={entries} selectedPaths={selectedPaths} onSelectionChange={onSelectionChange} renderMenu={renderMenu} />
					) : (
						<GitFlatList entries={entries} selectedPaths={selectedPaths} onSelectionChange={onSelectionChange} renderMenu={renderMenu} />
					)}
				</div>
			)}
		</div>
	);
}
