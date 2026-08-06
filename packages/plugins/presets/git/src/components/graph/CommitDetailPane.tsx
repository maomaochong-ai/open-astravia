import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useCallback, useEffect, useState } from "react";
import { commitFileDiff, commitFiles } from "../../git/log";
import { parseNameStatus } from "../../git/parseLog";
import type { ChangeEntry, CommitNode } from "../../git/types";
import { DiffView } from "../DiffView";
import { GitFileTree } from "../GitFileTree";
import { GitFlatList } from "../GitFlatList";
import { CloseIcon, ListViewIcon, TreeViewIcon } from "../icons";
import { StatusBadge } from "../StatusBadge";
import { CommitMeta } from "./CommitMeta";

type ViewMode = "tree" | "flat";
// Shared with GitChanges so the tree/flat preference stays consistent across views.
const VIEW_MODE_KEY = "vetta-git-view-mode";

function basename(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? path : path.slice(i + 1);
}

/** Loads and renders the diff of one file at a commit (vs its first parent). */
function CommitFileDiff({ root, hash, entry }: { root: string; hash: string; entry: ChangeEntry }): JSX.Element {
	const { t } = useTranslation();
	const [patch, setPatch] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		setPatch(null);
		setError(null);
		commitFileDiff(root, hash, entry.path)
			.then((p) => alive && setPatch(p))
			.catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
		return () => {
			alive = false;
		};
	}, [root, hash, entry.path]);

	return (
		// Natural height (no cap, no internal scroll): the panel scrolls as a whole.
		// Background matches the activity panel (--muted).
		<div className="shrink-0 border-t border-border bg-muted">
			<div className="flex h-7 items-center gap-1.5 border-b border-border px-2">
				<span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}>
					{basename(entry.path)}
				</span>
				<StatusBadge code={entry.code} />
			</div>
			{error ? (
				<div className="px-3 py-2 text-[12px] text-rose-500">{error}</div>
			) : patch === null ? (
				<div className="px-3 py-2 text-[12px] text-muted-foreground">{t("diff.loading")}</div>
			) : patch.trim().length === 0 ? (
				<div className="px-3 py-2 text-[12px] text-muted-foreground">{t("diff.empty")}</div>
			) : (
				<DiffView patch={patch} />
			)}
		</div>
	);
}

/** Right-hand slide-out: commit metadata, then a tree/flat file list above the selected file's diff. */
export function CommitDetailPane({ root, node, onClose }: { root: string; node: CommitNode; onClose: () => void }): JSX.Element {
	const { t } = useTranslation();
	const [files, setFiles] = useState<ChangeEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<ViewMode>(() =>
		typeof localStorage !== "undefined" && localStorage.getItem(VIEW_MODE_KEY) === "flat" ? "flat" : "tree",
	);

	const toggleView = useCallback(() => {
		setViewMode((m) => {
			const next: ViewMode = m === "tree" ? "flat" : "tree";
			try {
				localStorage.setItem(VIEW_MODE_KEY, next);
			} catch {}
			return next;
		});
	}, []);

	useEffect(() => {
		let alive = true;
		setFiles(null);
		setError(null);
		setSelectedPath(null);
		commitFiles(root, node.hash)
			.then((raw) => {
				if (!alive) return;
				const parsed = parseNameStatus(raw);
				setFiles(parsed);
				setSelectedPath(parsed[0]?.path ?? null);
			})
			.catch((err: unknown) => {
				if (alive) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			alive = false;
		};
	}, [root, node.hash]);

	const selectedEntry = selectedPath ? (files?.find((f) => f.path === selectedPath) ?? null) : null;

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
				<span className="git-mono min-w-0 flex-1 truncate text-[12px] text-muted-foreground" title={node.hash}>
					{node.hash.slice(0, 8)}
				</span>
				<Button type="button" variant="ghost" size="icon-xs" onClick={onClose} title={t("commit.close")}>
					<CloseIcon className="h-3.5 w-3.5" />
				</Button>
			</div>

			{error ? (
				<div className="px-3 py-2 text-[12px] text-rose-500">{error}</div>
			) : files === null ? (
				<div className="px-3 py-2 text-[12px] text-muted-foreground">{t("state.loading")}</div>
			) : (
				// Whole-panel vertical scroll: metadata, the height-capped file list, and
				// the natural-height diff all scroll together when they exceed the viewport.
				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
					<CommitMeta node={node} />
					<div className="flex h-7 shrink-0 items-center justify-end border-b border-border px-1.5">
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onClick={toggleView}
							title={viewMode === "tree" ? t("view.switchToFlat") : t("view.switchToTree")}
						>
							{viewMode === "tree" ? <ListViewIcon className="h-3.5 w-3.5" /> : <TreeViewIcon className="h-3.5 w-3.5" />}
						</Button>
					</div>
					{/* File list: auto height, capped, scrolls internally past the cap. */}
					<div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border">
						{viewMode === "tree" ? (
							<GitFileTree entries={files} selectedPath={selectedPath} onSelect={setSelectedPath} />
						) : (
							<GitFlatList entries={files} selectedPath={selectedPath} onSelect={setSelectedPath} />
						)}
					</div>
					{selectedEntry && <CommitFileDiff root={root} hash={node.hash} entry={selectedEntry} />}
				</div>
			)}
		</div>
	);
}
