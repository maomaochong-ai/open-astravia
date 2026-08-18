import type { TabBarDragEvent, TabBarItem } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import type { FloatingActivityTabPlacement } from "@shared/store/atoms";
import type { RefObject } from "react";
import type { ResolvedActivityTab } from "../../registry/types";
import type { ActivityTabBounds, ActivityTabPoint } from "../../services/floating-activity-tab";
import type { HiddenTabEntry } from "../PluginTabPicker";

export interface ActivityPanelProps {
	cwd?: string | null;
	enablePluginTabs?: boolean;
	knowledgeHistory?: boolean;
}

export interface ActivityPanelModel {
	activeTab: ActivityTabKey;
	/** 已注册且未 attach 的插件 tab，供「+」菜单从可添加池挂入。 */
	availablePluginTabs: HiddenTabEntry[];
	bottomSheet: boolean;
	cwd: string | null;
	dockPreviewBounds: ActivityTabBounds | null;
	floatingTabs: readonly FloatingActivityTabPlacement[];
	isOpen: boolean;
	isResizing: boolean;
	knowledgeHistory: boolean;
	mainTabListRef: RefObject<HTMLDivElement | null>;
	/** 当前需挂载的 tab：激活项、浮动项及显式 keepAlive 项。 */
	mountedTabs: ResolvedActivityTab[];
	narrowSheet: boolean;
	overflowTabs: HiddenTabEntry[];
	panelRef: RefObject<HTMLDivElement | null>;
	restorableTabs: HiddenTabEntry[];
	showTabPicker: boolean;
	tabItems: TabBarItem<ActivityTabKey>[];
	width: number;
}

export interface ActivityPanelActions {
	onAttachPluginTab: (key: string) => void;
	onClose: () => void;
	onFloatingResize: (key: ActivityTabKey, delta: ActivityTabPoint) => void;
	onFloatingResizeEnd: (key: ActivityTabKey) => void;
	onFloatingTabDragEnd: (event: TabBarDragEvent<ActivityTabKey>) => boolean | undefined;
	onFloatingTabDragMove: (event: TabBarDragEvent<ActivityTabKey>) => void;
	onFloatingTabDragStart: (event: TabBarDragEvent<ActivityTabKey>) => void;
	onFloatingTabFocus: (key: ActivityTabKey) => void;
	onOverflowChange: (keys: ActivityTabKey[]) => void;
	onRemoveTab: (key: ActivityTabKey) => void;
	onReorderTabs: (keys: ActivityTabKey[]) => void;
	onResize: (delta: number) => void;
	onResizeEnd: () => void;
	onRestoreTab: (key: string) => void;
	onTabChange: (key: ActivityTabKey) => void;
	onTabDragEnd: (event: TabBarDragEvent<ActivityTabKey>) => boolean | undefined;
	onTabDragMove: (event: TabBarDragEvent<ActivityTabKey>) => void;
	onTabDragStart: (event: TabBarDragEvent<ActivityTabKey>) => void;
}
