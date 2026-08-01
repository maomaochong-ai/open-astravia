import type { TabBarItem } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import type { ActivityTabDefinition, ResolvedActivityTab } from "../../registry/types";
import type { HiddenTabEntry } from "../PluginTabPicker";

export interface ActivityPanelProps {
	cwd?: string | null;
	enablePluginTabs?: boolean;
	knowledgeHistory?: boolean;
}

export interface ActivityPanelModel {
	/** 当前激活 tab 的 definition（内容区按 component 渲染）。 */
	activeDefinition: ActivityTabDefinition | null;
	activeTab: ActivityTabKey;
	/** 已注册且未 attach 的插件 tab，供「+」菜单从可添加池挂入。 */
	availablePluginTabs: HiddenTabEntry[];
	bottomSheet: boolean;
	cwd: string | null;
	isOpen: boolean;
	isResizing: boolean;
	/** 需保活但未激活的 tab（CSS 隐藏挂载）。 */
	keepAliveTabs: ResolvedActivityTab[];
	knowledgeHistory: boolean;
	narrowSheet: boolean;
	overflowTabs: HiddenTabEntry[];
	restorableTabs: HiddenTabEntry[];
	showTabPicker: boolean;
	tabItems: TabBarItem<ActivityTabKey>[];
	width: number;
}

export interface ActivityPanelActions {
	onAttachPluginTab: (key: string) => void;
	onClose: () => void;
	onOverflowChange: (keys: ActivityTabKey[]) => void;
	onRemoveTab: (key: ActivityTabKey) => void;
	onReorderTabs: (keys: ActivityTabKey[]) => void;
	onResize: (delta: number) => void;
	onResizeEnd: () => void;
	onRestoreTab: (key: string) => void;
	onTabChange: (key: ActivityTabKey) => void;
}
