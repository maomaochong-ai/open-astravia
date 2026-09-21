import { ResizeHandle } from "@shared/components/ResizeHandle";
import { collectBottomPanelLeaves } from "@shared/store/atoms";
import { BottomPanelEmptyState, BottomPanelFrame } from "@vetta-org/theme-ui/bottom-panel";
import { type JSX, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBottomPanelModel } from "../hooks/useBottomPanelModel";
import { BottomPanelAddMenu } from "./BottomPanelAddMenu";
import { BottomPanelLeaf } from "./BottomPanelLeaf";
import { BottomPanelSplitView } from "./BottomPanelSplitView";

/**
 * 会话页底部面板。
 *
 * 挂在会话页根容器里、与「消息列 + 活动面板」那一行是纵向兄弟，所以横跨整页宽度。
 * 折叠或没有任何 tab 时整块不渲染——此时 tab 以 pill 的形式出现在输入框下方。
 */
export function BottomPanelHost(): JSX.Element | null {
	const { t } = useTranslation("chat");
	const model = useBottomPanelModel();
	const containerRef = useRef<HTMLDivElement | null>(null);

	const onHeightResize = useCallback(
		(deltaPx: number) => {
			const available = containerRef.current?.parentElement?.getBoundingClientRect().height ?? 0;
			model?.sizing.onHeightResize(deltaPx, available);
		},
		[model],
	);

	if (!model) return null;
	const { state, definitions, cwd, canSplit, sizing, tabs, setCollapsed } = model;
	const root = state.root;
	const collapsed = state.collapsed;
	// 折叠时用 hidden 藏起来而不是卸载：卸载会把每个 tab 里的进程和滚动缓冲一起带走，
	// 而折叠是高频动作。真正的卸载只发生在整块被关掉或切换会话时。
	// 藏起来后容器尺寸是 0，终端里的 fit 有下限保护，不会算出 0 行。
	if (collapsed && !root) return null;
	const leaves = root ? collectBottomPanelLeaves(root) : [];

	return (
		<div
			ref={containerRef}
			hidden={collapsed}
			className="relative shrink-0 px-2 pb-2"
			style={{ height: `${Math.round(state.heightRatio * 100)}%` }}
			data-bottom-panel-root
		>
			{/* 把手贴在面板上沿：往上拖把面板拉高。 */}
			<ResizeHandle
				side="top"
				onResizeStart={sizing.onHeightResizeStart}
				onResize={onHeightResize}
				onResizeEnd={sizing.onHeightResizeEnd}
			/>
			<BottomPanelFrame className="h-full">
				{/*
				 * 没有任何 tab 时也要把面板画出来：不然用户点了右上角按钮什么都没发生，
				 * 也就没有地方添加第一个 tab。
				 */}
				{root === null ? (
					<BottomPanelEmptyState
						title={t("bottomPanel.empty.title")}
						description={t("bottomPanel.empty.description")}
						action={
							<BottomPanelAddMenu
								definitions={definitions}
								state={state}
								onPick={(definition) => tabs.openComponent(definition)}
							/>
						}
					/>
				) : (
				<BottomPanelSplitView
					node={root}
					onResizeStart={sizing.onSplitResizeStart}
					onResize={sizing.onSplitResize}
					onResizeEnd={sizing.onSplitResizeEnd}
					renderLeaf={(leafId) => {
						const leaf = leaves.find((entry) => entry.id === leafId);
						if (!leaf) return null;
						return (
							<BottomPanelLeaf
								leaf={leaf}
								state={state}
								definitions={definitions}
								cwd={cwd}
								focused={state.activeLeafId === leaf.id}
								panelCollapsed={state.collapsed}
								canSplit={canSplit}
								onSelectTab={tabs.activateTab}
								onCloseTab={tabs.closeTab}
								onOpenComponent={tabs.openComponent}
								onSplit={tabs.splitLeaf}
								onCollapse={() => setCollapsed(true)}
								onFocus={tabs.focusLeaf}
							/>
						);
					}}
				/>
				)}
			</BottomPanelFrame>
		</div>
	);
}
