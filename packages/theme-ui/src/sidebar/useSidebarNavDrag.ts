import type { SidebarNavItem } from "@vetta/theme-sdk/sidebar";
import type { DragEvent } from "react";
import { useCallback, useMemo, useState } from "react";

/** 拖拽载荷的自定义 MIME，避免与文件 / 会话拖拽串台。 */
export const SIDEBAR_NAV_DRAG_MIME = "application/x-vetta-sidebar-nav";

export type SidebarNavRegion = "pinned" | "more";

export interface SidebarNavDropTarget {
	region: SidebarNavRegion;
	/** 插入到该 key 之前；null 表示插到该区末尾。 */
	beforeKey: string | null;
}

export interface SidebarNavDragState {
	/** 正在拖动的 key，未拖动时为 null。 */
	draggingKey: string | null;
	/** 当前悬停的落点，用于画插入指示线。 */
	dropTarget: SidebarNavDropTarget | null;
}

export interface SidebarNavDragHandlers {
	/** 绑到可拖动条目上。 */
	itemProps: (
		item: SidebarNavItem,
		region: SidebarNavRegion,
	) => {
		draggable: boolean;
		onDragStart: (event: DragEvent<HTMLElement>) => void;
		onDragEnd: () => void;
		onDragOver: (event: DragEvent<HTMLElement>) => void;
		onDrop: (event: DragEvent<HTMLElement>) => void;
	};
	/** 绑到某一区的容器上，接住「落在末尾」的情况。 */
	regionProps: (region: SidebarNavRegion) => {
		onDragOver: (event: DragEvent<HTMLElement>) => void;
		onDrop: (event: DragEvent<HTMLElement>) => void;
	};
	/** 该条目上方是否应画插入指示线。 */
	isDropBefore: (key: string, region: SidebarNavRegion) => boolean;
	/** 该区末尾是否应画插入指示线。 */
	isDropAtEnd: (region: SidebarNavRegion) => boolean;
}

/**
 * 侧边栏导航项拖拽排序 / 跨区移动。用原生 HTML5 DnD：条目本来就是按钮，
 * 不需要额外的指针事件层，也不引入新依赖。
 *
 * 语义统一为「插到某个 key 之前」——落在条目**上半部**插到它之前，落在**下半部**
 * 插到它之后（即下一个 key 之前），落在容器空白处插到末尾。容量与「新会话」锁位
 * 一律由模型层兜底，这里不做业务判断。
 */
export function useSidebarNavDrag(
	onMove: (key: string, region: SidebarNavRegion, beforeKey: string | null) => void,
	itemsByRegion: Readonly<Record<SidebarNavRegion, readonly SidebarNavItem[]>>,
): SidebarNavDragState & SidebarNavDragHandlers {
	const [draggingKey, setDraggingKey] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<SidebarNavDropTarget | null>(null);

	const reset = useCallback(() => {
		setDraggingKey(null);
		setDropTarget(null);
	}, []);

	const readDragKey = useCallback(
		(event: DragEvent<HTMLElement>): string | null => {
			// dragover 时多数浏览器不允许读取数据，退回内存中的 draggingKey。
			const fromData = event.dataTransfer.getData(SIDEBAR_NAV_DRAG_MIME);
			return fromData || draggingKey;
		},
		[draggingKey],
	);

	const commit = useCallback(
		(event: DragEvent<HTMLElement>, target: SidebarNavDropTarget) => {
			event.preventDefault();
			event.stopPropagation();
			const key = readDragKey(event);
			reset();
			if (!key || key === target.beforeKey) return;
			onMove(key, target.region, target.beforeKey);
		},
		[onMove, readDragKey, reset],
	);

	const hover = useCallback((event: DragEvent<HTMLElement>, target: SidebarNavDropTarget) => {
		if (!event.dataTransfer.types.includes(SIDEBAR_NAV_DRAG_MIME)) return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = "move";
		setDropTarget((prev) =>
			prev && prev.region === target.region && prev.beforeKey === target.beforeKey ? prev : target,
		);
	}, []);

	/** 落在条目下半部 ⇒ 插到它的下一个之前（末位则为 null）。 */
	const resolveItemTarget = useCallback(
		(event: DragEvent<HTMLElement>, item: SidebarNavItem, region: SidebarNavRegion): SidebarNavDropTarget => {
			const rect = event.currentTarget.getBoundingClientRect();
			const after = event.clientY - rect.top > rect.height / 2;
			if (!after) return { region, beforeKey: item.key };
			const list = itemsByRegion[region];
			const index = list.findIndex((candidate) => candidate.key === item.key);
			const next = index >= 0 ? list[index + 1] : undefined;
			return { region, beforeKey: next ? next.key : null };
		},
		[itemsByRegion],
	);

	return useMemo(
		() => ({
			draggingKey,
			dropTarget,
			itemProps: (item, region) => ({
				// 锁定项（「新会话」）不参与拖拽，也不作为落点计算的例外——模型会把
				// 任何试图插到它之前的落位夹到它之后。
				draggable: item.locked !== true,
				onDragStart: (event) => {
					if (item.locked === true) return;
					event.dataTransfer.effectAllowed = "move";
					event.dataTransfer.setData(SIDEBAR_NAV_DRAG_MIME, item.key);
					setDraggingKey(item.key);
				},
				onDragEnd: reset,
				onDragOver: (event) => hover(event, resolveItemTarget(event, item, region)),
				onDrop: (event) => commit(event, resolveItemTarget(event, item, region)),
			}),
			regionProps: (region) => ({
				onDragOver: (event) => hover(event, { region, beforeKey: null }),
				onDrop: (event) => commit(event, { region, beforeKey: null }),
			}),
			isDropBefore: (key, region) =>
				dropTarget !== null && dropTarget.region === region && dropTarget.beforeKey === key,
			isDropAtEnd: (region) => dropTarget !== null && dropTarget.region === region && dropTarget.beforeKey === null,
		}),
		[commit, draggingKey, dropTarget, hover, reset, resolveItemTarget],
	);
}
