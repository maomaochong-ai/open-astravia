import { SettingsSidebarView } from "@vetta/theme-ui/settings";
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
			tabs={model.tabs}
			title={model.title}
		/>
	);
}
