import { TabBar } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import { ActivityPanel as ActivityPanelPrimitive } from "@vetta-org/theme-ui/activity";
import { type ComponentType, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDockedContentReady } from "../../hooks/useDockedContentReady";
import { useDockedOutlet } from "../../hooks/useDockedOutlet";
import { PluginTabPicker } from "../PluginTabPicker";
import { ActivityTabSurface } from "./ActivityTabSurface";
import type { ActivityPanelFrameProps } from "./ActivityPanelFrame";
import type { ActivityPanelActions, ActivityPanelModel } from "./types";

interface ActivityPanelViewProps {
	actions: ActivityPanelActions;
	Frame: ComponentType<ActivityPanelFrameProps>;
	model: ActivityPanelModel;
}

export function ActivityPanelView({
	actions,
	Frame,
	model,
}: ActivityPanelViewProps): JSX.Element {
	const { t } = useTranslation("project");
	const removeLabel = t("tabPicker.hideTab");
	// A closed docked panel must not keep its measurement-heavy visual tree alive.
	// Floating tabs are independent windows and remain mounted below.
	const renderDockedPanel = model.isOpen;
	// 面板滑出是主线程上的 width 过渡，tab 内容的首次挂载（插件面板还要先取回并求值
	// 懒加载 chunk）若与之同帧，长任务一来动画就卡在半路。壳与标签栏照常随开随挂，
	// 内容等过渡结束再挂；浮出的标签不受影响。
	const desktopRef = useRef<HTMLElement>(null);
	const dockedContentReady = useDockedContentReady(model.isOpen, desktopRef);
	const mountDockedContent = renderDockedPanel && dockedContentReady;
	const tabBar =
		renderDockedPanel &&
		(model.tabItems.length > 0 || model.floatingTabs.length > 0 || model.showTabPicker) ? (
				<TabBar
					className="min-w-0 flex-1"
					items={model.tabItems}
					activateOnFileDragHover
					listRef={model.mainTabListRef}
					value={model.activeTab}
					onChange={actions.onTabChange}
					onTabDragStart={model.narrowSheet ? undefined : actions.onTabDragStart}
					onTabDragMove={model.narrowSheet ? undefined : actions.onTabDragMove}
					onTabDragEnd={model.narrowSheet ? undefined : actions.onTabDragEnd}
					suppressLayoutAnimation={model.isResizing}
					onRemove={model.knowledgeHistory ? undefined : actions.onRemoveTab}
					removeLabel={removeLabel}
					onReorder={model.knowledgeHistory ? undefined : actions.onReorderTabs}
					onOverflowChange={model.knowledgeHistory ? undefined : actions.onOverflowChange}
				/>
			) : null;

	const tabPicker = renderDockedPanel && model.showTabPicker ? (
				<PluginTabPicker
					hiddenTabs={model.restorableTabs}
					onRestore={actions.onRestoreTab}
					overflowTabs={model.overflowTabs}
					onSelectOverflow={(key) => actions.onTabChange(key as ActivityTabKey)}
					availablePluginTabs={model.availablePluginTabs}
					onAttachPlugin={actions.onAttachPluginTab}
				/>
			) : null;
	const [dockedOutlet, registerDockedOutlet] = useDockedOutlet();

	const panelBody = renderDockedPanel ? (
		<>
			{tabBar || tabPicker ? (
				<ActivityPanelPrimitive.Header>
					{tabBar}
					{tabPicker}
				</ActivityPanelPrimitive.Header>
			) : null}
			<Frame>
				<ActivityPanelPrimitive.Body ref={model.panelRef}>
					<div ref={registerDockedOutlet} className="flex min-h-0 flex-1 flex-col" />
				</ActivityPanelPrimitive.Body>
			</Frame>
		</>
	) : null;

	return (
		<>
			<ActivityPanelPrimitive.Root
				isOpen={model.isOpen}
				isResizing={model.isResizing}
				width={model.width}
				minWidth={model.minWidth}
				maxWidth={model.maxWidth}
				onOpenChange={(open) => {
					if (!open) actions.onClose();
				}}
				onResizeStart={actions.onResizeStart}
				onResize={actions.onResize}
				onResizeEnd={actions.onResizeEnd}
			>
				<ActivityPanelPrimitive.Desktop ref={desktopRef} present={!model.narrowSheet}>
					<ActivityPanelPrimitive.Surface>{panelBody}</ActivityPanelPrimitive.Surface>
					<ActivityPanelPrimitive.ResizeHandle />
				</ActivityPanelPrimitive.Desktop>
				<ActivityPanelPrimitive.Sheet present={model.bottomSheet}>
					{panelBody}
				</ActivityPanelPrimitive.Sheet>
			</ActivityPanelPrimitive.Root>
			{model.dockPreviewBounds && (
				<div
					aria-hidden
					className="pointer-events-none fixed z-30 rounded-t-lg border border-primary/50 bg-primary/10"
					style={{
						left: model.dockPreviewBounds.left,
						top: model.dockPreviewBounds.top,
						width: model.dockPreviewBounds.width,
						height: model.dockPreviewBounds.height,
					}}
				/>
			)}
			{model.mountedTabs.map((tab) => {
				const floating = model.floatingTabs.find((placement) => placement.key === tab.id) ?? null;
				if (!mountDockedContent && floating === null) return null;
				return (
					<ActivityTabSurface
						key={`${model.workspaceId}:${tab.id}`}
						actions={actions}
						dockedOutlet={dockedOutlet}
						Frame={Frame}
						floating={floating}
						isActiveDocked={floating === null && tab.id === model.activeTab}
						removeLabel={removeLabel}
						tab={tab}
					/>
				);
			})}
		</>
	);
}
