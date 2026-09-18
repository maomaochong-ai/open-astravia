import { SettingsSidebarView } from "@vetta-org/theme-ui/settings";
import { prefetchSettingsTab } from "./settings-tab-loaders";
import type { SettingsPageModel } from "./types";

export interface SettingsSidebarProps {
	model: SettingsPageModel;
}

export function SettingsSidebar({ model }: SettingsSidebarProps): JSX.Element {
	return (
		<SettingsSidebarView
			activeTab={model.activeTab}
			betaBadgeLabel={model.betaBadgeLabel}
			narrow={model.narrow}
			onSelectTab={(tab) => model.onSelectTab(tab as typeof model.activeTab)}
			onTabIntent={prefetchSettingsTab}
			tabs={model.tabs}
			onSelectChild={model.onSelectNavigationChild}
			activeChildKey={model.activeNavigationChildKey}
			title={model.title}
		/>
	);
}
