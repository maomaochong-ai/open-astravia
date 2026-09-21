import { useSidebarState } from "@shared/app-shell/sidebar-state";
import { ResizeHandle } from "@shared/components/ResizeHandle";
import { cn } from "@shared/lib/utils";
import { activityPanelOpenAtom, collectBottomPanelLeaves } from "@shared/store/atoms";
import { BottomPanelEmptyPicker, BottomPanelEmptyState, BottomPanelFrame } from "@vetta-org/theme-ui/bottom-panel";
import { useAtomValue } from "jotai";
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
	const activityPanelOpen = useAtomValue(activityPanelOpenAtom);
	// 左缘是否已经被侧边栏占住，决定那 8px 是要补还是要抵消。读 useSidebarState 而不是
	// sidebarCollapsedAtom：窄屏时侧边栏改走悬浮层、同样不占左栏，两个来源合成才是真相。
	const sidebarVisible = useSidebarState().visible;
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
			className={cn(
				"relative shrink-0",
				// 消息列四周的留白本来就不对称：下和右各有 8px（AppFrame 的 p-2、这一行的
				// gap-2），左边只有侧边栏不在位时才有那 8px。所以左边总要单独处理一次。
				activityPanelOpen
					// 活动面板展开时收成卡片，四边留白与活动面板到窗口的距离对齐。
					? sidebarVisible && "ml-2"
					// 活动面板收起时铺到窗口边缘：此时这一行只剩底部面板，留白会让它看着像浮层。
					: cn("-mr-2 -mb-2", !sidebarVisible && "-ml-2"),
			)}
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
			<BottomPanelFrame
				className={cn(
					"h-full border-border",
					// 铺到边缘时只画与消息流之间那条分界线；收成卡片才需要整圈边框和圆角。
					activityPanelOpen ? "rounded-xl border" : "border-t",
				)}
			>
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
