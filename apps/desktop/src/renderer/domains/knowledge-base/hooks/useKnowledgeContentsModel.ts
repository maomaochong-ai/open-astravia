import {
	confirmDialogAtom,
	ensureKnowledgePathLoadedAtom,
	filePreviewAtom,
	knowledgeBrowsePathByBaseAtom,
	knowledgeFileStatusesAtom,
	knowledgeNavTargetAtom,
	knowledgeStatusesHydratedAtom,
	knowledgeViewModeAtom,
	refreshKnowledgeBasesAtom,
} from "@shared/store/atoms";
import type { KnowledgeBase, KnowledgeNode, KnowledgeProcessStatus } from "@shared/types/knowledge-base";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextMenuItem } from "../components/KnowledgeContextMenu";
import {
	isKnowledgeDirLoaded,
	knowledgeBaseDisplayName,
	knowledgeNodeMatches,
	nodesAtPath,
	resolveKnowledgeFileStatus,
	shouldHoldForStatuses,
} from "../lib/knowledge-base";

interface UseKnowledgeContentsModelParams {
	knowledgeBase: KnowledgeBase;
	search: string;
}

type MenuState = { x: number; y: number; node: KnowledgeNode };

/** 稳定空路径：`?? []` 每次渲染都是新引用，会让依赖 path 的 effect 死循环。 */
const EMPTY_PATH: string[] = [];

export function useKnowledgeContentsModel({ knowledgeBase, search }: UseKnowledgeContentsModelParams) {
	const { t } = useTranslation(["settings", "common"]);
	const baseName = knowledgeBaseDisplayName(knowledgeBase);
	const [pathByBase, setPathByBase] = useAtom(knowledgeBrowsePathByBaseAtom);
	const path = pathByBase[knowledgeBase.id] ?? EMPTY_PATH;
	/** path 序列化键，作 effect 依赖（避免数组引用抖动）。 */
	const pathKey = path.join("/");
	const setPath = useCallback(
		(next: string[] | ((prev: string[]) => string[])) => {
			setPathByBase((prev) => {
				const current = prev[knowledgeBase.id] ?? EMPTY_PATH;
				const value = typeof next === "function" ? next(current) : next;
				if (current.length === value.length && current.every((seg, i) => seg === value[i])) return prev;
				return { ...prev, [knowledgeBase.id]: value };
			});
		},
		[knowledgeBase.id, setPathByBase],
	);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [anchorId, setAnchorId] = useState<string | null>(null);
	const [menu, setMenu] = useState<MenuState | null>(null);
	const [renameNode, setRenameNode] = useState<KnowledgeNode | null>(null);
	/** 当前面包屑路径链上的某层尚未回填时为 true，用于骨架而非「空目录」闪一下。 */
	const [levelLoading, setLevelLoading] = useState(false);
	const confirm = useSetAtom(confirmDialogAtom);
	const refresh = useSetAtom(refreshKnowledgeBasesAtom);
	const ensurePathLoaded = useSetAtom(ensureKnowledgePathLoadedAtom);
	const openPreview = useSetAtom(filePreviewAtom);
	const fileStatuses = useAtomValue(knowledgeFileStatusesAtom);
	const statusesHydrated = useAtomValue(knowledgeStatusesHydratedAtom);
	const viewMode = useAtomValue(knowledgeViewModeAtom);
	const [navTarget, setNavTarget] = useAtom(knowledgeNavTargetAtom);

	const statusFor = useCallback(
		(node: KnowledgeNode): KnowledgeProcessStatus | null => {
			if (node.type !== "file") return null;
			// 缺 key = 尚未回填，不得默认 unprocessed（否则首屏整表误灰）。
			return resolveKnowledgeFileStatus(fileStatuses, knowledgeBase.id, node.id);
		},
		[fileStatuses, knowledgeBase.id],
	);

	const wikiPathFor = useCallback(
		(node: KnowledgeNode): string | undefined =>
			node.type === "file" ? fileStatuses[`${knowledgeBase.id}/${node.id}`]?.wikiPath : undefined,
		[fileStatuses, knowledgeBase.id],
	);

	const openWiki = useCallback(
		(wikiPath: string) => {
			const name = wikiPath.split(/[/\\]/).pop() ?? "wiki.md";
			openPreview({ items: [{ name, path: wikiPath }], index: 0 });
		},
		[openPreview],
	);

	const clearSelection = useCallback(() => {
		// 已空则跳过：new Set() 每次新引用，盲目 set 会触发多余渲染。
		setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
		setAnchorId((prev) => (prev === null ? prev : null));
	}, []);

	// 切库 / 切目录后清空选中（path 按库存在 atom，切库不丢各自位置）
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathKey 代表 path 内容
	useEffect(() => {
		clearSelection();
	}, [pathKey, knowledgeBase.id, clearSelection]);

	useEffect(() => {
		if (!navTarget) return;
		const segments = navTarget.fileId.split("/").slice(0, -1);
		const atTarget = segments.length === path.length && segments.every((seg, i) => seg === path[i]);
		if (!atTarget) {
			setPath(segments);
			return;
		}
		// 目标层可能仍在懒加载：本层 nodes 尚未含该文件则等下一轮。
		const level = nodesAtPath(knowledgeBase.nodes, path);
		if (!level?.some((n) => n.id === navTarget.fileId)) return;
		const el = document.querySelector(`[data-knode-id="${CSS.escape(navTarget.fileId)}"]`);
		if (!el) return;
		setSelectedIds(new Set([navTarget.fileId]));
		setAnchorId(navTarget.fileId);
		el.scrollIntoView({ block: "center" });
		setNavTarget(null);
	}, [navTarget, path, setNavTarget, knowledgeBase.nodes, setPath]);

	useEffect(() => window.vetta.knowledge.onStatusesChanged(() => void refresh()), [refresh]);

	// 进入目录 / 深链跳转：按路径链逐层 listDir。依赖 pathKey（内容）而非 path 引用。
	useEffect(() => {
		if (isKnowledgeDirLoaded(knowledgeBase.nodes, pathKey)) {
			setLevelLoading((prev) => (prev ? false : prev));
			return;
		}
		let cancelled = false;
		setLevelLoading(true);
		const segments = pathKey ? pathKey.split("/") : EMPTY_PATH;
		void ensurePathLoaded({ kbId: knowledgeBase.id, pathSegments: segments })
			.catch(() => {})
			.finally(() => {
				if (!cancelled) setLevelLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [ensurePathLoaded, knowledgeBase.id, knowledgeBase.nodes, pathKey]);

	const currentNodes = useMemo(() => nodesAtPath(knowledgeBase.nodes, path), [knowledgeBase.nodes, path]);
	const query = search.trim().toLocaleLowerCase();
	const visibleNodes = useMemo(() => {
		if (!currentNodes) return [];
		return query ? currentNodes.filter((node) => knowledgeNodeMatches(node, query)) : currentNodes;
	}, [currentNodes, query]);
	const filesAtLevel = useMemo(() => (currentNodes ?? []).filter((node) => node.type === "file"), [currentNodes]);
	/** 本层未加载完，或本层有文件但加工态未回填：骨架，避免空态/灰闪；不卸载面板。 */
	const levelPending =
		levelLoading || currentNodes === null || shouldHoldForStatuses({ statusesHydrated, levelNodes: currentNodes });

	const openNode = useCallback(
		(node: KnowledgeNode) => {
			if (node.type === "directory") {
				setPath((prev) => [...prev, node.name]);
				return;
			}
			if (!node.sourcePath) return;
			const index = filesAtLevel.findIndex((item) => item.id === node.id);
			if (index < 0) return;
			openPreview({
				items: filesAtLevel.map((item) => ({
					name: item.name,
					path: item.sourcePath,
					size: item.size,
				})),
				index,
			});
		},
		[filesAtLevel, openPreview, setPath],
	);

	const onItemClick = useCallback(
		(node: KnowledgeNode, event: React.MouseEvent) => {
			if (event.shiftKey && anchorId) {
				const a = visibleNodes.findIndex((n) => n.id === anchorId);
				const b = visibleNodes.findIndex((n) => n.id === node.id);
				if (a >= 0 && b >= 0) {
					const [lo, hi] = a < b ? [a, b] : [b, a];
					setSelectedIds(new Set(visibleNodes.slice(lo, hi + 1).map((n) => n.id)));
				}
				return;
			}
			if (event.metaKey || event.ctrlKey) {
				setSelectedIds((prev) => {
					const next = new Set(prev);
					if (next.has(node.id)) next.delete(node.id);
					else next.add(node.id);
					return next;
				});
				setAnchorId(node.id);
				return;
			}
			setSelectedIds(new Set([node.id]));
			setAnchorId(node.id);
		},
		[anchorId, visibleNodes],
	);

	const onContextMenu = useCallback(
		(node: KnowledgeNode, event: React.MouseEvent) => {
			if (!selectedIds.has(node.id)) {
				setSelectedIds(new Set([node.id]));
				setAnchorId(node.id);
			}
			setMenu({ x: event.clientX, y: event.clientY, node });
		},
		[selectedIds],
	);

	const deleteIds = useCallback(
		(ids: string[], label: string) => {
			confirm({
				title: t("settings:kbEntryDeleteTitle"),
				message: t("settings:kbEntryDeleteMsg", { base: baseName, label }),
				variant: "danger",
				confirmLabel: t("common:actions.delete"),
				onConfirm: () => {
					void (async () => {
						for (const id of ids) {
							await window.vetta.knowledge.deleteEntry(knowledgeBase.id, id).catch(() => {});
						}
						clearSelection();
						await refresh();
					})();
				},
			});
		},
		[confirm, knowledgeBase.id, baseName, refresh, clearSelection, t],
	);

	const deleteWiki = useCallback(
		(ids: string[], label: string) => {
			confirm({
				title: t("settings:kbWikiDeleteTitle"),
				message: t("settings:kbWikiDeleteMsg", { label }),
				variant: "danger",
				confirmLabel: t("settings:kbWikiDeleteConfirm"),
				onConfirm: () => {
					void (async () => {
						await window.vetta.knowledge.deleteWiki(knowledgeBase.id, ids).catch(() => {});
						clearSelection();
						await refresh();
					})();
				},
			});
		},
		[confirm, knowledgeBase.id, refresh, clearSelection, t],
	);

	const submitRename = useCallback(
		(newName: string) => {
			const node = renameNode;
			setRenameNode(null);
			if (!node) return;
			void window.vetta.knowledge.renameEntry(knowledgeBase.id, node.id, newName).then(() => refresh());
		},
		[renameNode, knowledgeBase.id, refresh],
	);

	const menuItems = useMemo((): ContextMenuItem[] => {
		if (!menu) return [];
		const ids = [...selectedIds];
		if (ids.length > 1) {
			const selectedLabel = t("settings:kbLabelSelectedItems", { n: ids.length });
			return [
				{
					label: t("settings:kbMenuDeleteWikiSelected", { n: ids.length }),
					icon: "icon-[mdi--file-document-remove-outline]",
					onClick: () => deleteWiki(ids, selectedLabel),
				},
				{
					label: t("settings:kbMenuDeleteSelected", { n: ids.length }),
					icon: "icon-[mdi--trash-can-outline]",
					danger: true,
					onClick: () => deleteIds(ids, selectedLabel),
				},
			];
		}
		const node = menu.node;
		const wikiPath = wikiPathFor(node);
		const nodeLabel = t("settings:kbLabelNode", { name: node.name });
		return [
			...(wikiPath
				? [
						{
							label: t("settings:kbMenuViewWiki"),
							icon: "icon-[mdi--text-box-search-outline]",
							onClick: () => openWiki(wikiPath),
						},
						{
							label: t("settings:kbWikiDeleteTitle"),
							icon: "icon-[mdi--file-document-remove-outline]",
							onClick: () => deleteWiki([node.id], nodeLabel),
						},
					]
				: []),
			{
				label: t("settings:kbMenuRename"),
				icon: "icon-[mdi--rename-outline]",
				onClick: () => setRenameNode(node),
			},
			{
				label: t("settings:kbEntryDeleteTitle"),
				icon: "icon-[mdi--trash-can-outline]",
				danger: true,
				onClick: () => deleteIds([node.id], nodeLabel),
			},
		];
	}, [menu, selectedIds, deleteIds, deleteWiki, wikiPathFor, openWiki, t]);

	const onBackgroundClick = useCallback(
		(event: React.MouseEvent) => {
			if (!(event.target as HTMLElement).closest("[data-knode]")) clearSelection();
		},
		[clearSelection],
	);

	const navigateBreadcrumb = useCallback(
		(index: number) => setPath(index < 0 ? [] : path.slice(0, index + 1)),
		[path, setPath],
	);

	return {
		baseName,
		clearSelection,
		levelPending,
		menu,
		menuItems,
		navigateBreadcrumb,
		onBackgroundClick,
		onContextMenu,
		onItemClick,
		openNode,
		path,
		query,
		renameNode,
		selectedIds,
		setMenu,
		setRenameNode,
		setSelectedIds,
		statusFor,
		submitRename,
		viewMode,
		visibleNodes,
	};
}
