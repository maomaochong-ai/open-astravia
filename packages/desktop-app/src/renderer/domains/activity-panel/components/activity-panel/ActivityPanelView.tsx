import type { ComponentType } from "react";
import { PluginActivityTabPanel } from "@domains/plugins/components/PluginActivityTabPanel";
import { TabBar } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import { ActivityPanelView as ThemeActivityPanelView } from "@vetta/theme-ui/activity";
import { BackgroundTasksTabPanel } from "../BackgroundTasksTabPanel";
import { BatchProgressTabPanel } from "../BatchProgressTabPanel";
import { BrowserPanel } from "../BrowserPanel";
import { DebugTabPanel } from "../DebugTabPanel";
import { FileTabContent } from "../file-tab/FileTabContent";
import { KnowledgeHistoryPanel } from "../KnowledgeHistoryPanel";
import { PluginTabPicker } from "../PluginTabPicker";
import { ScheduleExecutionTabPanel } from "../ScheduleExecutionTabPanel";
import { TodoTabPanel } from "../TodoTabPanel";
import { WorkflowTabPanel } from "../WorkflowTabPanel";
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
	const tabBar =
		model.tabItems.length > 0 || model.showTabPicker ? (
			<TabBar
				className="min-w-0 flex-1"
				items={model.tabItems}
				value={model.activeTab}
				onChange={actions.onTabChange}
				suppressLayoutAnimation={model.isResizing}
				onRemove={model.knowledgeHistory ? undefined : actions.onRemoveTab}
				onReorder={model.knowledgeHistory ? undefined : actions.onReorderTabs}
				onOverflowChange={model.knowledgeHistory ? undefined : actions.onOverflowChange}
			/>
		) : null;

	const tabPicker = model.showTabPicker ? (
		<PluginTabPicker
			hiddenTabs={model.restorableTabs}
			onRestore={actions.onRestoreTab}
			overflowTabs={model.overflowTabs}
			onSelectOverflow={(key) => actions.onTabChange(key as ActivityTabKey)}
			availablePluginTabs={model.availablePluginTabs}
			onAttachPlugin={actions.onAttachPluginTab}
		/>
	) : null;

	const panelContent = (
		<div key={model.cwd ?? "__none__"} className="flex min-h-0 flex-1 flex-col">
			{model.activeTab === "file" && <FileTabContent cwd={model.cwd} />}
			{model.activeTab === "batch-progress" && model.cwd && <BatchProgressTabPanel cwd={model.cwd} />}
			{model.activeTab === "schedule-records" && model.cwd && (
				<ScheduleExecutionTabPanel cwd={model.cwd} />
			)}
			{model.activeTab === "todo" && model.cwd && <TodoTabPanel />}
			{model.activeTab === "background-tasks" && model.cwd && <BackgroundTasksTabPanel />}
			{model.activeTab === "workflow" && model.cwd && <WorkflowTabPanel />}
			{model.activeTab === "debug" && model.cwd && <DebugTabPanel cwd={model.cwd} />}
			{model.activeTab === "knowledge-history" && <KnowledgeHistoryPanel cwd={model.cwd} />}
			{model.activePluginTab && model.cwd && (
				<PluginActivityTabPanel tab={model.activePluginTab} cwd={model.cwd} />
			)}
			{model.cwd && (model.activeTab === "browser" || model.browserUrl !== null) && (
				<div
					className={
						model.activeTab === "browser" ? "flex min-h-0 flex-1 flex-col" : "hidden"
					}
				>
					<BrowserPanel />
				</div>
			)}
		</div>
	);

	return (
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
	);
}
