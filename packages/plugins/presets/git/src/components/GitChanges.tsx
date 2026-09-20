import { preloadHighlighter } from "@pierre/diffs";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findEntry } from "../git/gitStatus";
import { resizePanel } from "../git/runtime";
import type { ChangeRef, ChangeSection, StatusGroups } from "../git/types";
import type { MenuPoint } from "./ChangeMenu";
import { FloatingChangeMenu } from "./ChangeMenu";
import { BranchBar } from "./BranchBar";
import { ChangeSectionList } from "./ChangeSectionList";
import { CommitBox } from "./CommitBox";
import { ConfirmDialog } from "./ConfirmDialog";
import { DiffPane } from "./DiffPane";
import { GitActions } from "./GitActions";
import { FileIcon, ListViewIcon, StageIcon, TreeViewIcon, UnstageIcon } from "./icons";
import { SplitHandle } from "./SplitHandle";
import { useChangeActions } from "./useChangeActions";

type ViewMode = "tree" | "flat";
const VIEW_MODE_KEY = "vetta-git-view-mode";

// 容器宽于此值时显示右侧 diff 区；窄于此值只显示文件树（拖窄自动收起 diff）。
// 阈值要留得住「树 + 一屏能读的 diff」，否则一拉宽就挤出一条读不了的窄 diff。
const DIFF_MIN_WIDTH = 560;
const TREE_DEFAULT_WIDTH = 300;
const TREE_MIN_WIDTH = 180;
// diff 展开时给右侧 diff 保留的最小宽度，限制树列最大宽度。
const DIFF_RESERVED_WIDTH = 260;

/** Files listed by name in the discard confirmation before it says "and N more". */
const DISCARD_PREVIEW = 5;

/** Render order of the sections: conflicts first, they block committing. */
const SECTION_ORDER: readonly ChangeSection[] = ["conflict", "staged", "unstaged"];

/** Selection is confined to one section at a time (see {@link ChangeSectionList}). */
interface Selection {
	section: ChangeSection;
	paths: readonly string[];
}

/** Ready-state body: sectioned change list on the left, width-gated diff pane on the right. */
export function GitChanges({ root, groups }: { root: string; groups: StatusGroups }): JSX.Element {
	const { t } = useTranslation();
	const [containerWidth, setContainerWidth] = useState(0);
	const [active, setActive] = useState<ChangeRef | null>(null);
	const [selection, setSelection] = useState<Selection>({ section: "unstaged", paths: [] });
	const [collapsed, setCollapsed] = useState<Record<ChangeSection, boolean>>({
		conflict: false,
		staged: false,
		unstaged: false,
	});
	const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
	const [treeCollapsed, setTreeCollapsed] = useState(false);
	const [viewMode, setViewMode] = useState<ViewMode>(() =>
		typeof localStorage !== "undefined" && localStorage.getItem(VIEW_MODE_KEY) === "flat" ? "flat" : "tree",
	);

	const actions = useChangeActions(root, groups);

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

	/**
	 * Width probe as a callback ref, not a mount effect.
	 *
	 * The measured element only exists while there are changes, so a `[]` effect
	 * would run once against a null ref on a clean tree and never retry — the
	 * panel then stayed in its narrow single-column layout no matter how wide the
	 * user dragged it, and the diff pane never appeared.
	 */
	const observerRef = useRef<ResizeObserver | null>(null);
	const measureRef = useCallback((el: HTMLDivElement | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		if (!el) return;
		setContainerWidth(el.getBoundingClientRect().width);
		const observer = new ResizeObserver((items) => {
			for (const item of items) setContainerWidth(item.contentRect.width);
		});
		observer.observe(el);
		observerRef.current = observer;
	}, []);

	useEffect(() => () => observerRef.current?.disconnect(), []);

	const total = groups.conflict.length + groups.staged.length + groups.unstaged.length;
	const wide = containerWidth >= DIFF_MIN_WIDTH;
	const activeEntry = active ? findEntry(groups[active.section], active.path) : null;
	const showTree = !wide || !treeCollapsed;

	// 拉宽且无有效选择时，默认选中第一个变更文件（仿文件活动面板）。
	// 选中文件被移除（刷新后失效）时也回落到第一个。
	useEffect(() => {
		if (!wide || activeEntry) return;
		for (const section of SECTION_ORDER) {
			const first = groups[section][0];
			if (first) {
				setActive({ section, path: first.path });
				return;
			}
		}
	}, [wide, activeEntry, groups]);

	// 收起 diff（窄屏或无选择）时复位树折叠态，避免残留隐藏。
	useEffect(() => {
		if (!wide || !activeEntry) setTreeCollapsed(false);
	}, [wide, activeEntry]);

	// 选中变化：只保留一个分区的多选，并把「刚进入选中的那个文件」作为 diff 的对象。
	// 窄屏点文件时把面板拉到最大并打开 diff（仿文件面板）。
	const handleSelection = useCallback(
		(section: ChangeSection, paths: string[], added: string | null) => {
			setSelection({ section, paths });
			if (added) {
				setActive({ section, path: added });
				if (!wide) resizePanel("max");
			}
		},
		[wide],
	);

	const onSplitDrag = useCallback(
		(deltaX: number) => {
			setTreeWidth((w) => {
				const max = Math.max(TREE_MIN_WIDTH, containerWidth - DIFF_RESERVED_WIDTH);
				return Math.max(TREE_MIN_WIDTH, Math.min(max, w + deltaX));
			});
		},
		[containerWidth],
	);

	const sectionTitles = useMemo<Record<ChangeSection, string>>(
		() => ({
			conflict: t("section.conflict"),
			staged: t("section.staged"),
			unstaged: t("section.unstaged"),
		}),
		[t],
	);

	// 两种视图共用同一个浮层菜单：它 portal 到 body 并做视口夹取，不会被列容器裁掉。
	const renderSectionMenu = useCallback(
		(section: ChangeSection, paths: string[], close: () => void, point?: MenuPoint): JSX.Element => (
			<FloatingChangeMenu x={point?.x ?? 0} y={point?.y ?? 0} target={{ section, paths }} handlers={actions.handlers} onClose={close} />
		),
		[actions.handlers],
	);

	const renderSectionActions = (section: ChangeSection): JSX.Element | null => {
		if (section === "staged") {
			return (
				<Button type="button" variant="ghost" size="icon-xs" title={t("action.unstageAll")} disabled={actions.busy} onClick={actions.unstageAllFiles}>
					<UnstageIcon className="h-3.5 w-3.5" />
				</Button>
			);
		}
		if (section === "unstaged") {
			return (
				<Button type="button" variant="ghost" size="icon-xs" title={t("action.stageAll")} disabled={actions.busy} onClick={actions.stageAllFiles}>
					<StageIcon className="h-3.5 w-3.5" />
				</Button>
			);
		}
		return null;
	};

	const discardCount = actions.pendingDiscard ? actions.pendingDiscard.tracked.length + actions.pendingDiscard.untracked.length : 0;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
				<BranchBar root={root} />
				<div className="ml-auto flex items-center gap-1">
					<GitActions root={root} />
				{total > 0 && (
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
			</div>

			{total === 0 ? (
				<div className="flex flex-1 items-center justify-center px-3 py-4 text-[12px] text-muted-foreground">{t("state.clean")}</div>
			) : (
				<div ref={measureRef} className="flex min-h-0 flex-1 overflow-hidden">
					{showTree && (
						<div
							className={
								wide
									? "relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border"
									: "flex min-h-0 flex-1 flex-col overflow-hidden"
							}
							style={wide ? { width: treeWidth } : undefined}
						>
							<CommitBox root={root} groups={groups} />
							{/* 分区自己吃满剩余高度并各自内部滚动，外层不再整体滚动。 */}
							<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
								{SECTION_ORDER.map((section) => (
									<ChangeSectionList
										key={section}
										title={sectionTitles[section]}
										entries={groups[section]}
										viewMode={viewMode}
										collapsed={collapsed[section]}
										onToggleCollapsed={() => setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }))}
										selectedPaths={selection.section === section ? selection.paths : []}
										onSelectionChange={(paths, added) => handleSelection(section, paths, added)}
										renderMenu={(paths, close, point) => renderSectionMenu(section, paths, close, point)}
										actions={renderSectionActions(section)}
										tone={section === "conflict" ? "danger" : undefined}
									/>
								))}
							</div>
							{wide && <SplitHandle onDrag={onSplitDrag} />}
						</div>
					)}
					{wide &&
						(activeEntry && active ? (
							<DiffPane
								root={root}
								entry={activeEntry}
								section={active.section}
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

			{actions.error && (
				<button
					type="button"
					onClick={actions.dismissError}
					title={t("action.dismiss")}
					className="shrink-0 border-t border-border px-3 py-1.5 text-left text-[11px] text-rose-500"
				>
					{actions.error}
				</button>
			)}

			<ConfirmDialog
				open={actions.pendingDiscard !== null}
				destructive
				title={t("discard.title", { count: discardCount })}
				description={t("discard.description")}
				detail={
					actions.pendingDiscard && (
						<ul className="max-h-32 overflow-y-auto rounded border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
							{[...actions.pendingDiscard.tracked, ...actions.pendingDiscard.untracked].slice(0, DISCARD_PREVIEW).map((path) => (
								<li key={path} className="truncate">
									{path}
								</li>
							))}
							{discardCount > DISCARD_PREVIEW && <li className="italic">{t("discard.more", { count: discardCount - DISCARD_PREVIEW })}</li>}
						</ul>
					)
				}
				confirmLabel={t("discard.confirm")}
				onConfirm={actions.confirmDiscard}
				onCancel={actions.cancelDiscard}
			/>
		</div>
	);
}
