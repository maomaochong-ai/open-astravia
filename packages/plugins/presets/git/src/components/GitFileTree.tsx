import { themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import { buildGitStatus } from "../git/gitStatus";
import type { ChangeEntry } from "../git/types";
import type { MenuPoint } from "./ChangeMenu";
import { readCssVar, useHostMode } from "./hostTheme";

/** Same membership, ignoring order — used to skip echoes of our own sync. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	const set = new Set(a);
	return b.every((item) => set.has(item));
}

/**
 * File tree backed by `@pierre/trees`: renders one section's change set as a
 * path-first hierarchy with built-in git-status badges (M/A/D/R/U) and the
 * descendant indicator on folders.
 *
 * Selection lives in the parent (one section may be multi-selected at a time),
 * and the tree contributes its native ctrl/cmd-additive and shift-range click
 * handling on top of it. This component never owns the diff.
 */
export function GitFileTree({
	entries,
	selectedPaths,
	onSelectionChange,
	renderMenu,
}: {
	entries: readonly ChangeEntry[];
	selectedPaths: readonly string[];
	/** `added` is the path that was just brought into the selection, if any. */
	onSelectionChange: (paths: string[], added: string | null) => void;
	/** Context-menu body for the right-clicked paths; omit to disable the menu. */
	renderMenu?: (paths: string[], close: () => void, point?: MenuPoint) => ReactNode;
}): JSX.Element {
	const mode = useHostMode();
	const { paths, gitStatus } = useMemo(() => buildGitStatus(entries), [entries]);

	// onSelectionChange 经 ref 透传：useFileTree 只在挂载时读一次 options，闭包不能捕获会过期的回调。
	const onChangeRef = useRef(onSelectionChange);
	onChangeRef.current = onSelectionChange;
	// 最近一次已知选中集，用来算出「新进入选中的那个路径」并过滤自身同步产生的回声。
	const knownRef = useRef<readonly string[]>(selectedPaths);

	const { model } = useFileTree({
		paths,
		gitStatus,
		initialExpansion: "open",
		flattenEmptyDirectories: true,
		onSelectionChange: (selected) => {
			const next = [...selected];
			if (sameSet(next, knownRef.current)) return;
			const added = next.find((path) => !knownRef.current.includes(path)) ?? null;
			knownRef.current = next;
			onChangeRef.current(next, added);
		},
	});

	// 刷新/切换后增量同步：复用同一 model 实例，重置路径与 git 状态。
	// 首次挂载跳过——model 已由 useFileTree 用初始 paths/gitStatus 播种（也避免多余 reset 影响初始展开）。
	const seededRef = useRef(false);
	useEffect(() => {
		if (!seededRef.current) {
			seededRef.current = true;
			return;
		}
		model.resetPaths(paths);
		model.setGitStatus(gitStatus);
	}, [model, paths, gitStatus]);

	// 选中态由外部驱动：把 model 的选中集对齐到 props（含清空——切到别的分区多选时本分区要退出选中）。
	useEffect(() => {
		if (sameSet(model.getSelectedPaths(), selectedPaths)) {
			knownRef.current = selectedPaths;
			return;
		}
		knownRef.current = selectedPaths;
		for (const path of model.getSelectedPaths()) {
			if (!selectedPaths.includes(path)) model.getItem(path)?.deselect();
		}
		for (const path of selectedPaths) {
			const item = model.getItem(path);
			if (item && !item.isSelected()) item.select();
		}
	}, [model, selectedPaths]);

	const style = useMemo<React.CSSProperties>(() => {
		// 背景沿用活动面板卡片底色（--muted），让树与宿主面板融为一体。
		const bg = readCssVar("--muted");
		const fg = readCssVar("--foreground");
		const border = readCssVar("--border");
		const accent = readCssVar("--accent");
		return {
			...(themeToTreeStyles({ type: mode, bg, fg }) as React.CSSProperties),
			"--trees-fg-override": fg,
			"--trees-border-color-override": border,
			"--trees-selected-bg-override": accent,
			height: "100%",
			width: "100%",
		} as React.CSSProperties;
	}, [mode]);

	// 右键作用于「右键那一行」：它已在多选内就对整个多选生效，否则只针对它自己。
	const menuTarget = (path: string): string[] => (selectedPaths.includes(path) ? [...selectedPaths] : [path]);

	return (
		<FileTree
			model={model}
			style={style}
			renderContextMenu={
				renderMenu
					? (item, context) =>
							item.kind === "file"
								? // 锚在行的左下角：菜单自己会做视口夹取，面板贴着窗口右缘时也不会被裁掉。
									renderMenu(menuTarget(item.path), () => context.close(), {
										x: context.anchorRect.left,
										y: context.anchorRect.bottom,
									})
								: null
					: undefined
			}
		/>
	);
}
