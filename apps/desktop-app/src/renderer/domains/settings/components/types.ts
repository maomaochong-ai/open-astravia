import type { SettingsTab } from "@shared/store/atoms";

export interface SettingsNavigationItem {
	beta?: boolean;
	icon: string;
	key: SettingsTab;
	label: string;
	title?: string;
}

export interface SettingsPageModel {
	activeTab: SettingsTab;
	betaBadgeLabel: string;
	narrow: boolean;
	onSelectTab: (tab: SettingsTab) => void;
	tabs: readonly SettingsNavigationItem[];
	title: string;
}
