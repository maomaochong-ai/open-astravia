import type { ConversationScenario } from "@astravia-org/plugin-sdk";
import type { TabBarDragEvent, TabBarItem } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import type { FloatingActivityTabPlacement } from "@shared/store/atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { RefObject } from "react";
import type { ResolvedActivityTab } from "../../registry/types";
import type { ActivityTabBounds, ActivityTabPoint } from "../../services/floating-activity-tab";
import type { TabPickerEntry } from "../PluginTabPicker";

export interface ActivityPanelProps {
	workspace: ActivityWorkspace;
	enablePluginTabs?: boolean;
	knowledgeHistory?: boolean;
	/** Host-selected static abilities. Omitted means every built-in contribution. */
	enabledBuiltinTabs?: readonly string[];
	pluginScenario?: ConversationScenario;
}

export interface ActivityPanelModel {
	activeTab: ActivityTabKey;
	/** 未上栏但可添加的面板（插件未 attach / 内置未添加），供「+」菜单挂入。 */
	availableTabs: TabPickerEntry[];
	bottomSheet: boolean;
	cwd: string | null;
	workspaceId: string;
	dockPreviewBounds: ActivityTabBounds | null;
	floatingTabs: readonly FloatingActivityTabPlacement[];
	isOpen: boolean;
	isResizing: boolean;
	knowledgeHistory: boolean;
	maxWidth: number;
	mainTabListRef: RefObject<HTMLDivElement | null>;
	minWidth: number;
	/** 当前需挂载的 tab：激活项、浮动项及显式 keepAlive 项。 */
	mountedTabs: ResolvedActivityTab[];
	narrowSheet: boolean;
	overflowTabs: TabPickerEntry[];
	panelRef: RefObject<HTMLDivElement | null>;
	restorableTabs: TabPickerEntry[];
	showTabPicker: boolean;
	tabItems: TabBarItem<ActivityTabKey>[];
	width: number;
}

export interface ActivityPanelActions {
	onAttachTab: (key: string) => void;
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
	onResizeStart: () => void;
	onResize: (width: number) => void;
	onResizeEnd: (width: number) => void;
	onRestoreTab: (key: string) => void;
	onTabChange: (key: ActivityTabKey) => void;
	onTabDragEnd: (event: TabBarDragEvent<ActivityTabKey>) => boolean | undefined;
	onTabDragMove: (event: TabBarDragEvent<ActivityTabKey>) => void;
	onTabDragStart: (event: TabBarDragEvent<ActivityTabKey>) => void;
}
