import { preloadHighlighter } from "@pierre/diffs";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { findEntry } from "../git/gitStatus";
import { resizePanel } from "../git/runtime";
import type { ChangeEntry } from "../git/types";
import { DiffPane } from "./DiffPane";
import { GitActions } from "./GitActions";
import { GitFileTree } from "./GitFileTree";
import { GitFlatList } from "./GitFlatList";
import { FileIcon, ListViewIcon, TreeViewIcon } from "./icons";
import { SplitHandle } from "./SplitHandle";

type ViewMode = "tree" | "flat";
const VIEW_MODE_KEY = "vetta-git-view-mode";

// 容器宽于此值时显示右侧 diff 区；窄于此值只显示文件树（拖窄自动收起 diff）。
const DIFF_MIN_WIDTH = 460;
// 关闭 diff 时把面板收窄到此宽度（低于阈值即收起 diff，回到只剩树）。
const COLLAPSE_WIDTH = 380;
const TREE_DEFAULT_WIDTH = 248;
const TREE_MIN_WIDTH = 180;
// diff 展开时给右侧 diff 保留的最小宽度，限制树列最大宽度。
const DIFF_RESERVED_WIDTH = 260;

/** Ready-state body: file tree on the left, width-gated diff pane on the right. */
export function GitChanges({ root, entries }: { root: string; entries: ChangeEntry[] }): JSX.Element {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
	const [treeCollapsed, setTreeCollapsed] = useState(false);
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

	// 预热 diff 高亮器：共享高亮器是会话级单例，首个 diff 渲染时若主题尚未挂载，
	// 渲染器会跳过同步渲染返回空白，须切换文件才恢复。文件列表出现即提前挂载明暗
	// 两套主题，让首个 diff 直接同步渲染（重复调用因单例守卫而无副作用）。
	useEffect(() => {
		void preloadHighlighter({ themes: ["github-dark-default", "github-light-default"], langs: ["text"] });
	}, []);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const observer = new ResizeObserver((items) => {
			for (const item of items) setContainerWidth(item.contentRect.width);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const wide = containerWidth >= DIFF_MIN_WIDTH;
	const selectedEntry = selectedPath ? findEntry(entries, selectedPath) : null;
	const showTree = !wide || !treeCollapsed;

	// 拉宽且无有效选择时，默认选中第一个变更文件（仿文件活动面板）。
	// 选中文件被移除（刷新后失效）时也回落到第一个。
	useEffect(() => {
		if (!wide || selectedEntry) return;
		const first = entries[0];
		if (first) setSelectedPath(first.path);
	}, [wide, selectedEntry, entries]);

	// 收起 diff（窄屏或无选择）时复位树折叠态，避免残留隐藏。
	useEffect(() => {
		if (!wide || !selectedEntry) setTreeCollapsed(false);
	}, [wide, selectedEntry]);

	// 仅文件可驱动 diff：点目录只在树内展开/折叠，不改选中。
	// 窄屏点文件时把面板拉到最大并打开 diff（仿文件面板）。
	const handleSelect = useCallback(
		(path: string) => {
			if (!findEntry(entries, path)) return;
			setSelectedPath(path);
			if (!wide) resizePanel("max");
		},
		[entries, wide],
	);

	// 关闭 diff：把面板收窄到阈值以下，回到只剩树（保留选中，再拉宽即恢复同一文件）。
	const handleClose = useCallback(() => resizePanel(COLLAPSE_WIDTH), []);

	const onSplitDrag = useCallback(
		(deltaX: number) => {
			setTreeWidth((w) => {
				const max = Math.max(TREE_MIN_WIDTH, containerWidth - DIFF_RESERVED_WIDTH);
				return Math.max(TREE_MIN_WIDTH, Math.min(max, w + deltaX));
			});
		},
		[containerWidth],
	);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
				<GitActions root={root} />
				{entries.length > 0 && (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={toggleView}
						title={viewMode === "tree" ? t("view.switchToFlat") : t("view.switchToTree")}
					>
						{viewMode === "tree" ? <ListViewIcon className="h-3.5 w-3.5" /> : <TreeViewIcon className="h-3.5 w-3.5" />}
					</Button>
				)}
			</div>

			{entries.length === 0 ? (
				<div className="flex flex-1 items-center justify-center px-3 py-4 text-[12px] text-muted-foreground">{t("state.clean")}</div>
			) : (
				<div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
					{showTree && (
						<div
							className={
								wide
									? "relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border"
									: "flex min-h-0 flex-1 flex-col overflow-hidden"
							}
							style={wide ? { width: treeWidth } : undefined}
						>
							<div className="flex min-h-0 flex-1 flex-col">
								{viewMode === "tree" ? (
									<GitFileTree entries={entries} selectedPath={selectedPath} onSelect={handleSelect} />
								) : (
									<GitFlatList entries={entries} selectedPath={selectedPath} onSelect={handleSelect} />
								)}
							</div>
							{wide && <SplitHandle onDrag={onSplitDrag} />}
						</div>
					)}
					{wide &&
						(selectedEntry ? (
							<DiffPane
								root={root}
								entry={selectedEntry}
								onClose={handleClose}
								onToggleTree={() => setTreeCollapsed((c) => !c)}
								treeCollapsed={treeCollapsed}
							/>
						) : (
							<div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
								<FileIcon className="h-6 w-6 opacity-50" />
								<span className="text-[12px]">{t("diff.selectPrompt")}</span>
							</div>
						))}
				</div>
			)}
		</div>
	);
}
