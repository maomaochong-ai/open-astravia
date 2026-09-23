import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { useCallback, useEffect, useState } from "react";
import { commitFileDiff, commitFiles } from "../../git/log";
import { parseNameStatus } from "../../git/parseLog";
import type { ChangeEntry, CommitNode } from "../../git/types";
import { GitFileTree } from "../GitFileTree";
import { GitFlatList } from "../GitFlatList";
import { CloseIcon, ListViewIcon, TreeViewIcon } from "../icons";
import { PatchContent } from "../PatchContent";
import { StatusBadge } from "../StatusBadge";
import { CommitMeta } from "./CommitMeta";

type ViewMode = "tree" | "flat";
const VIEW_MODE_KEY = "vetta-git-commit-view-mode";

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
		commitFileDiff(root, hash, entry)
			.then((p) => alive && setPatch(p))
			.catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
		return () => {
			alive = false;
		};
	}, [root, hash, entry]);

	return (
		// Natural height (no cap, no internal scroll): the panel scrolls as a whole.
		// Use the same diff surface as the working-changes pane.
		<div className="shrink-0 border-t border-border bg-background">
			<div className="flex h-7 items-center gap-1.5 border-b border-border px-2">
				<span
					className="min-w-0 flex-1 truncate text-[12px] text-foreground"
					title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
				>
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
				<PatchContent patch={patch} />
			)}
		</div>
	);
}

/** Right-hand slide-out: commit metadata, then a tree/flat file list above the selected file's diff. */
export function CommitDetailPane({
	root,
	node,
	onClose,
}: {
	root: string;
	node: CommitNode;
	onClose: () => void;
}): JSX.Element {
	const { t } = useTranslation();
	const [files, setFiles] = useState<ChangeEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	// 提交详情里一次只看一个文件的 diff，多选没有意义：把列表的选中集固定成这一个。
	const selectedPaths = selectedPath ? [selectedPath] : [];
	const handleSelection = useCallback((_paths: string[], added: string | null) => {
		if (added) setSelectedPath(added);
	}, []);
	const [viewMode, setViewMode] = useState<ViewMode>(() => {
		try {
			return localStorage.getItem(VIEW_MODE_KEY) === "tree" ? "tree" : "flat";
		} catch {
			return "flat";
		}
	});

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
					<div className="flex h-7 shrink-0 items-center justify-between border-b border-border px-1.5">
						<span className="text-[12px] text-muted-foreground">
							{t("commit.files", { count: files.length })}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onClick={toggleView}
							title={viewMode === "tree" ? t("view.switchToFlat") : t("view.switchToTree")}
						>
							{viewMode === "tree" ? (
								<ListViewIcon className="h-3.5 w-3.5" />
							) : (
								<TreeViewIcon className="h-3.5 w-3.5" />
							)}
						</Button>
					</div>
					{/* The virtual tree needs a definite viewport height; max-height alone collapses its host. */}
					<div className="shrink-0 overflow-y-auto border-b border-border" style={{ height: 192 }}>
						{files.length === 0 ? (
							<div className="px-3 py-2 text-[12px] text-muted-foreground">{t("commit.noFiles")}</div>
						) : viewMode === "tree" ? (
							<GitFileTree entries={files} selectedPaths={selectedPaths} onSelectionChange={handleSelection} />
						) : (
							<GitFlatList entries={files} selectedPaths={selectedPaths} onSelectionChange={handleSelection} />
						)}
					</div>
					{selectedEntry && <CommitFileDiff root={root} hash={node.hash} entry={selectedEntry} />}
				</div>
			)}
		</div>
	);
}
