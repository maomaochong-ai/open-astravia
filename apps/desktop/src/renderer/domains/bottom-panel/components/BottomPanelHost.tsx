import { ResizeHandle } from "@shared/components/ResizeHandle";
import { collectBottomPanelLeaves } from "@shared/store/atoms";
import { BottomPanelEmptyPicker, BottomPanelEmptyState, BottomPanelFrame } from "@vetta-org/theme-ui/bottom-panel";
import { type JSX, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBottomPanelModel } from "../hooks/useBottomPanelModel";
import { canOpenBottomPanelComponent } from "../registry/resolve-bottom-panel-tabs";
import { BottomPanelLeaf } from "./BottomPanelLeaf";
import { BottomPanelSplitView } from "./BottomPanelSplitView";

/**
 * 会话页底部面板。
 *
 * 挂在消息列内部的底部，只占消息列的宽度，不压到右侧活动面板下方——活动面板是与消息流
 * 并列的独立一列，被底部面板截断会让两者看起来是同一块区域。
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
			// 负边距把 AppFrame 的 p-2 和消息列与活动面板之间的 gap-2（各 8px）抵消掉：
			// 面板要贴死窗口下沿、右侧顶到活动面板，中间留缝就又成了一张浮层。
			className="-mr-2 -mb-2 relative shrink-0"
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
							<BottomPanelEmptyPicker
								label={t("bottomPanel.empty.pickerLabel")}
								choices={definitions.map((definition) => ({
									id: definition.id,
									label: definition.defaultMeta.label,
									icon: definition.defaultMeta.icon,
									hint: definition.pluginName,
									disabled: !canOpenBottomPanelComponent(state, definition),
									disabledReason: t("bottomPanel.addMenu.instanceLimit"),
								}))}
								onPick={(id) => {
									const definition = definitions.find((entry) => entry.id === id);
									if (definition) tabs.openComponent(definition);
								}}
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
