import type { TabBarItem } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import type { RegisteredActivityTab } from "@shared/store/atoms";
import type { HiddenTabEntry } from "../PluginTabPicker";

export interface ActivityPanelProps {
	cwd?: string | null;
	enablePluginTabs?: boolean;
	knowledgeHistory?: boolean;
}

export interface ActivityPanelModel {
	activePluginTab: RegisteredActivityTab | null;
	activeTab: ActivityTabKey;
	/** 已注册且未 attach 的插件 tab，供「+」菜单从可添加池挂入。 */
	availablePluginTabs: HiddenTabEntry[];
	bottomSheet: boolean;
	browserUrl: string | null;
	cwd: string | null;
	isOpen: boolean;
	isResizing: boolean;
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
