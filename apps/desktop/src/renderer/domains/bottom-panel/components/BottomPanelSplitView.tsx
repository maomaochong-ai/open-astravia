import type { BottomPanelNode } from "@shared/store/atoms";
import { ResizeHandle } from "@shared/components/ResizeHandle";
import { type JSX, type ReactNode, useCallback, useRef } from "react";

export interface BottomPanelSplitViewProps {
	readonly node: BottomPanelNode;
	readonly renderLeaf: (leafId: string) => ReactNode;
	readonly onResizeStart: () => void;
	/** delta 已按轴向换算成「左/上侧格子该变大多少像素」。 */
	readonly onResize: (groupId: string, index: number, deltaPx: number, extentPx: number) => void;
	readonly onResizeEnd: () => void;
}

/**
 * 按布局树递归渲染分屏。
 *
 * 比例靠 `flexGrow` 落地而不是自己算像素：浏览器分配剩余空间比我们精确，
 * 我们只需要在拖拽时把像素增量换回比例。
 */
export function BottomPanelSplitView({
	node,
	renderLeaf,
	onResizeStart,
	onResize,
	onResizeEnd,
}: BottomPanelSplitViewProps): JSX.Element {
	if (node.kind === "leaf") {
		return <>{renderLeaf(node.id)}</>;
	}
	return (
		<SplitGroup
			node={node}
			renderLeaf={renderLeaf}
			onResizeStart={onResizeStart}
			onResize={onResize}
			onResizeEnd={onResizeEnd}
		/>
	);
}

function SplitGroup({
	node,
	renderLeaf,
	onResizeStart,
	onResize,
	onResizeEnd,
}: BottomPanelSplitViewProps & { node: Extract<BottomPanelNode, { kind: "group" }> }): JSX.Element {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const horizontal = node.direction === "row";

	const handleResize = useCallback(
		(index: number, deltaPx: number) => {
			const rect = containerRef.current?.getBoundingClientRect();
			const extent = horizontal ? (rect?.width ?? 0) : (rect?.height ?? 0);
			onResize(node.id, index, deltaPx, extent);
		},
		[horizontal, node.id, onResize],
	);

	return (
		<div
			ref={containerRef}
			className={`flex min-h-0 min-w-0 flex-1 ${horizontal ? "flex-row" : "flex-col"}`}
			data-bottom-panel-group={node.id}
		>
			{node.children.map((child, index) => (
				<div
					key={child.id}
					className="relative flex min-h-0 min-w-0 flex-col"
					style={{ flexGrow: node.sizes[index] ?? 1, flexBasis: 0 }}
				>
					<BottomPanelSplitView
						node={child}
						renderLeaf={renderLeaf}
						onResizeStart={onResizeStart}
						onResize={onResize}
						onResizeEnd={onResizeEnd}
					/>
					{index < node.children.length - 1 ? (
						// 把手贴在本格子的结束边上：往那个方向拖就是把本格子拉大。
						<ResizeHandle
							side={horizontal ? "right" : "bottom"}
							onResizeStart={onResizeStart}
							onResize={(delta) => handleResize(index, delta)}
							onResizeEnd={onResizeEnd}
						/>
					) : null}
				</div>
			))}
		</div>
	);
}
