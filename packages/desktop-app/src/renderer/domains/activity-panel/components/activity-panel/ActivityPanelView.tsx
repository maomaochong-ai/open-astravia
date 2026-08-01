import type { ComponentType } from "react";
import { TabBar } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import { ActivityPanelView as ThemeActivityPanelView } from "@vetta/theme-ui/activity";
import { PluginTabPicker } from "../PluginTabPicker";
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

	const activeIsKeepAlive = model.activeDefinition?.keepAliveWhenAvailable === true;
	const ActiveComponent = model.activeDefinition?.component;

	const panelContent = (
		<div key={model.cwd ?? "__none__"} className="flex min-h-0 flex-1 flex-col">
			{/* 保活 tab：候选存在时始终挂载，激活用 flex、否则 hidden（避免 webview 重挂载）。 */}
			{model.keepAliveTabs.map((tab) => {
				const Comp = tab.definition.component;
				const active = tab.id === model.activeTab;
				return (
					<div
						key={tab.id}
						className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}
					>
						<Comp />
					</div>
				);
			})}
			{!activeIsKeepAlive && ActiveComponent ? <ActiveComponent /> : null}
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
