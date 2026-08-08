import { TabBar } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import { ActivityPanelView as ThemeActivityPanelView } from "@vetta/theme-ui/activity";
import { type ComponentType, useMemo, useState } from "react";
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
	const tabBar = useMemo(
		() =>
			model.tabItems.length > 0 || model.floatingTabs.length > 0 || model.showTabPicker ? (
				<TabBar
					className="min-w-0 flex-1"
					items={model.tabItems}
					listRef={model.mainTabListRef}
					value={model.activeTab}
					onChange={actions.onTabChange}
					onTabDragStart={model.narrowSheet ? undefined : actions.onTabDragStart}
					onTabDragMove={model.narrowSheet ? undefined : actions.onTabDragMove}
					onTabDragEnd={model.narrowSheet ? undefined : actions.onTabDragEnd}
					suppressLayoutAnimation={model.isResizing}
					onRemove={model.knowledgeHistory ? undefined : actions.onRemoveTab}
					onReorder={model.knowledgeHistory ? undefined : actions.onReorderTabs}
					onOverflowChange={model.knowledgeHistory ? undefined : actions.onOverflowChange}
				/>
			) : null,
		[
			actions.onOverflowChange,
			actions.onRemoveTab,
			actions.onReorderTabs,
			actions.onTabChange,
			actions.onTabDragEnd,
			actions.onTabDragMove,
			actions.onTabDragStart,
			model.activeTab,
			model.isResizing,
			model.floatingTabs.length,
			model.knowledgeHistory,
			model.mainTabListRef,
			model.narrowSheet,
			model.showTabPicker,
			model.tabItems,
		],
	);

	const tabPicker = useMemo(
		() =>
			model.showTabPicker ? (
				<PluginTabPicker
					hiddenTabs={model.restorableTabs}
					onRestore={actions.onRestoreTab}
					overflowTabs={model.overflowTabs}
					onSelectOverflow={(key) => actions.onTabChange(key as ActivityTabKey)}
					availablePluginTabs={model.availablePluginTabs}
					onAttachPlugin={actions.onAttachPluginTab}
				/>
			) : null,
		[
			actions.onAttachPluginTab,
			actions.onRestoreTab,
			actions.onTabChange,
			model.availablePluginTabs,
			model.overflowTabs,
			model.restorableTabs,
			model.showTabPicker,
		],
	);
	const [dockedOutlet, setDockedOutlet] = useState<HTMLDivElement | null>(null);

	const panelContent = useMemo(
		() => (
			<div ref={model.panelRef} className="flex min-h-0 flex-1 flex-col">
				<div ref={setDockedOutlet} className="flex min-h-0 flex-1 flex-col" />
			</div>
		),
		[model.panelRef],
	);

	return (
		<>
			<ThemeActivityPanelView
				Frame={Frame}
				isOpen={model.isOpen}
				isResizing={model.isResizing}
				width={model.width}
				narrowSheet={model.narrowSheet}
				bottomSheet={model.bottomSheet}
				tabBar={tabBar}
				tabPicker={tabPicker}
				panelContent={panelContent}
				onClose={actions.onClose}
				onResize={actions.onResize}
				onResizeEnd={actions.onResizeEnd}
			/>
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
				return (
					<ActivityTabSurface
						key={`${model.cwd ?? "__none__"}:${tab.id}`}
						actions={actions}
						dockedOutlet={dockedOutlet}
						Frame={Frame}
						floating={floating}
						isActiveDocked={floating === null && tab.id === model.activeTab}
						tab={tab}
					/>
				);
			})}
		</>
	);
}
