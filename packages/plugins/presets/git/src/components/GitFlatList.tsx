import type { MouseEvent } from "react";
import { useMemo, useRef } from "react";
import type { ChangeEntry } from "../git/types";
import { FileIcon } from "./icons";
import { StatusBadge } from "./StatusBadge";

/**
 * Flat ("平铺") view: every changed file as a single row showing basename +
 * dimmed directory + status badge, sorted by path. No directory nesting.
 *
 * Mirrors {@link GitFileTree}, including its click semantics: plain click
 * replaces the selection, ctrl/cmd toggles one row, shift extends from the last
 * clicked row. Selection is lifted to the parent.
 */
export function GitFlatList({
	entries,
	selectedPaths,
	onSelectionChange,
}: {
	entries: readonly ChangeEntry[];
	selectedPaths: readonly string[];
	/** `added` is the path that was just brought into the selection, if any. */
	onSelectionChange: (paths: string[], added: string | null) => void;
}): JSX.Element {
	const sorted = useMemo(() => [...entries].sort((a, b) => a.path.localeCompare(b.path)), [entries]);
	// Anchor for shift-range selection: the row of the last unmodified click.
	const anchorRef = useRef<string | null>(null);

	const handleClick = (path: string, event: MouseEvent): void => {
		const additive = event.ctrlKey || event.metaKey;
		if (event.shiftKey && anchorRef.current) {
			const from = sorted.findIndex((entry) => entry.path === anchorRef.current);
			const to = sorted.findIndex((entry) => entry.path === path);
			if (from >= 0 && to >= 0) {
				const [lo, hi] = from <= to ? [from, to] : [to, from];
				onSelectionChange(
					sorted.slice(lo, hi + 1).map((entry) => entry.path),
					path,
				);
				return;
			}
		}
		if (additive) {
			anchorRef.current = path;
			const selected = selectedPaths.includes(path);
			onSelectionChange(
				selected ? selectedPaths.filter((item) => item !== path) : [...selectedPaths, path],
				selected ? null : path,
			);
			return;
		}
		anchorRef.current = path;
		onSelectionChange([path], path);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
			{sorted.map((entry) => {
				const slash = entry.path.lastIndexOf("/");
				const dir = slash < 0 ? "" : entry.path.slice(0, slash + 1);
				const name = slash < 0 ? entry.path : entry.path.slice(slash + 1);
				const selected = selectedPaths.includes(entry.path);
				return (
					<button
						type="button"
						key={entry.path}
						onClick={(event) => handleClick(entry.path, event)}
						title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
						className={`flex items-center gap-1.5 px-2 py-1 text-left text-[12px] transition-colors ${
							selected ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/50"
						}`}
					>
						<FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
						<span className="min-w-0 flex-1 truncate">
							<span>{name}</span>
							{dir && <span className="text-muted-foreground/60"> {dir}</span>}
						</span>
						<StatusBadge code={entry.code} />
					</button>
				);
			})}
		</div>
	);
}
