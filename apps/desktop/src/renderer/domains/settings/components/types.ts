import type { SettingsTab } from "@shared/store/atoms";

export interface SettingsNavigationChild {
	key: string;
	label: string;
	icon: string;
	iconUrl?: string;
	title?: string;
}

export interface SettingsNavigationItem {
	beta?: boolean;
	icon: string;
	key: SettingsTab;
	label: string;
	title?: string;
	/** 可展开的下级入口；有值时侧栏项右侧出现展开按钮。 */
	children?: readonly SettingsNavigationChild[];
}

export interface SettingsPageModel {
	activeTab: SettingsTab;
	betaBadgeLabel: string;
	narrow: boolean;
	onSelectTab: (tab: SettingsTab) => void;
	tabs: readonly SettingsNavigationItem[];
	/** 内容区改渲染这个插件工作区视图（设置壳内嵌），而不是标签自己的设置页。 */
	embeddedView?: { pluginId: string; viewId: string };
	/** 展开的下级入口不是设置标签，由宿主自行导航（当前是插件工作区页面）。 */
	onSelectNavigationChild: (key: string) => void;
	/** 展开按钮的可访问名。 */
	expandLabel: string;
	/** 关闭内嵌视图，回到「更多选项」列表。 */
	onCloseEmbeddedView: () => void;
	/** 当前内嵌视图对应的下级入口 key，用于侧栏高亮与自动展开。 */
	activeNavigationChildKey?: string;
	title: string;
}
