import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { useEffect, useState } from "react";
import { fileDiff } from "../git/run";
import type { ChangeEntry, ChangeSection } from "../git/types";
import { FileTypeIcon } from "./FileTypeIcon";
import { SidebarIcon, SplitViewIcon, UnifiedViewIcon } from "./icons";
import { PatchContent } from "./PatchContent";
import { StatusBadge } from "./StatusBadge";

function basename(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? path : path.slice(i + 1);
}

/** Right-hand diff view for the selected change. Loads the patch and renders it. */
/** 记住上次选择的 diff 版式，跨文件与跨会话保持一致。 */
const DIFF_STYLE_KEY = "vetta-git-diff-style";

export function DiffPane({
	root,
	entry,
	section,
	onToggleTree,
	treeCollapsed,
}: {
	root: string;
	entry: ChangeEntry;
	/** Which list the file was picked from — decides index vs worktree diff. */
	section: ChangeSection;
	onToggleTree: () => void;
	treeCollapsed: boolean;
}): JSX.Element {
	const { t } = useTranslation();
	const [diffStyle, setDiffStyle] = useState<"unified" | "split">(() =>
		typeof localStorage !== "undefined" && localStorage.getItem(DIFF_STYLE_KEY) === "split" ? "split" : "unified",
	);
	const [patch, setPatch] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		setError(null);
		setPatch(null);
		fileDiff(root, entry, section)
			.then((value) => {
				if (alive) setPatch(value);
			})
			.catch((err: unknown) => {
				if (alive) setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [root, entry, section]);

	return (
		// 顶部内缩与提交卡片一致（pt-1 = mt-1），两块的上沿才在同一条线上；左上角用同一档
		// 圆角，否则一块圆角卡片紧挨着一个直角色块，接缝会很突兀。
		<div className="mb-2 ml-0.5 mr-2 mt-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-background">
			<div className="flex h-9 shrink-0 items-center gap-1.5 px-2">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					onClick={onToggleTree}
					title={treeCollapsed ? t("action.showTree") : t("action.hideTree")}
				>
					<SidebarIcon className="h-3.5 w-3.5" />
				</Button>
				<FileTypeIcon path={entry.path} className="h-4 w-4 shrink-0" />
				<span
					className="min-w-0 flex-1 truncate text-[12px] text-foreground"
					title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
				>
					{basename(entry.path)}
				</span>
				<StatusBadge code={entry.code} />
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					onClick={() => {
						const next = diffStyle === "unified" ? "split" : "unified";
						setDiffStyle(next);
						try {
							localStorage.setItem(DIFF_STYLE_KEY, next);
						} catch {}
					}}
					title={diffStyle === "unified" ? t("diff.switchToSplit") : t("diff.switchToUnified")}
				>
					{diffStyle === "unified" ? (
						<SplitViewIcon className="h-3.5 w-3.5" />
					) : (
						<UnifiedViewIcon className="h-3.5 w-3.5" />
					)}
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-auto">
				{loading && <div className="px-3 py-2 text-[12px] text-muted-foreground">{t("diff.loading")}</div>}
				{error && <div className="px-3 py-2 text-[12px] text-rose-500">{error}</div>}
				{!loading &&
					!error &&
					patch !== null &&
					(patch.trim().length === 0 ? (
						<div className="px-3 py-2 text-[12px] text-muted-foreground">{t("diff.empty")}</div>
					) : (
						<PatchContent patch={patch} diffStyle={diffStyle} />
					))}
			</div>
		</div>
	);
}
