import type { RefCallback } from "react";

export type SidebarFilter = "all" | "normal" | "batch";

export interface SidebarClassNames {
	readonly bottomBar?: string;
	readonly bottomBarSettings?: string;
	readonly navigation?: string;
	readonly navIndicator?: string;
	readonly navItem?: string;
	readonly navItemBadge?: string;
	readonly navItemIcon?: string;
	readonly navItemLabel?: string;
	readonly panel?: string;
	readonly panelContent?: string;
	readonly projects?: string;
	readonly projectsList?: string;
	readonly projectsToolbar?: string;
	readonly topBar?: string;
	readonly topBarActions?: string;
	readonly topBarBrand?: string;
	readonly topBarClawButton?: string;
	readonly topBarCollapseButton?: string;
}

export type SidebarLabelKey =
	| "sidebar.nav.newSession"
	| "sidebar.nav.automation"
	| "sidebar.nav.batchTasks"
	| "sidebar.nav.knowledge"
	| "sidebar.nav.skills"
	| "sidebar.nav.scenes"
	| "sidebar.nav.plugins"
	| "sidebar.nav.modelSettings"
	| "sidebar.nav.agentSettings"
	| "sidebar.nav.appearance"
	| "sidebar.nav.more";

export interface SidebarProps {
	readonly onOpenSession: (cwd: string, sessionPath?: string) => Promise<void>;
	readonly onCollapse?: () => void;
	readonly classNames?: SidebarClassNames;
	readonly floating?: boolean;
}

export type SidebarModelInput = Pick<SidebarProps, "floating" | "onCollapse">;

export interface SidebarRegionProps {
	readonly classNames?: SidebarClassNames;
	readonly model: SidebarModel;
	readonly onOpenSession: SidebarProps["onOpenSession"];
}

export interface SidebarNavItem {
	readonly active: boolean;
	readonly badge?: string;
	readonly icon: string;
	readonly key: string;
	readonly label?: string;
	readonly labelKey?: SidebarLabelKey;
	/** `/skills` 与 `/plugins` 为旧入口，现已重定向到 `/abilities`（ADR-0049）。 */
	readonly path?: "/automation" | "/batch-tasks" | "/knowledge" | "/abilities" | "/skills" | "/scenes" | "/plugins";
	/** 直达设置页某个 tab（`/settings/$tab`）；与 `path` 互斥。 */
	readonly settingsTab?: string;
	readonly title?: string;
	readonly titleLabelKey?: SidebarLabelKey;
	readonly type: "custom" | "new-session" | "route";
	/**
	 * 该项由插件的**工作区视图**（整页 surface）贡献，点击后落到
	 * `/workspace/<pluginId>/<viewId>`。与 `path` / `settingsTab` 互斥。
	 */
	readonly workspaceView?: { readonly pluginId: string; readonly viewId: string };
	/** 位置锁定（当前仅「新会话」）：不可拖动、不可收纳、恒在置顶区首位。 */
	readonly locked?: boolean;
	/** 该项当前是否在置顶区。由布局解析得出，供视图渲染 pin / unpin 动作。 */
	readonly pinned?: boolean;
}

export interface NavIndicatorBounds {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

export interface SidebarModel {
	readonly actions: {
		readonly collapse?: () => void;
		readonly openClawSettings: () => void;
		readonly openNavItem: (item: SidebarNavItem) => void;
		readonly resize: (delta: number) => void;
		readonly resizeEnd: () => void;
		readonly setMoreOpen: (open: boolean) => void;
		/** 把收纳项移到置顶区末尾；置顶区已满或该项锁定时为 no-op。 */
		readonly pinNavItem: (key: string) => void;
		/** 把置顶项收回收纳区最前；「新会话」为 no-op。 */
		readonly unpinNavItem: (key: string) => void;
		/**
		 * 拖拽落位：把 `key` 放进 `region`，插在 `beforeKey` 之前（null = 末尾）。
		 * 同区即重排，跨区即 pin / unpin；容量与锁位规则由模型统一兜底。
		 */
		readonly moveNavItem: (key: string, region: "pinned" | "more", beforeKey: string | null) => void;
		/** 恢复默认导航布局。 */
		readonly resetNavLayout: () => void;
	};
	readonly filter: SidebarFilter;
	readonly floating: boolean;
	readonly imOnline: boolean;
	/** 收纳菜单中任一项为当前路由时为 true（「更多」按钮高亮）。 */
	readonly moreActive: boolean;
	/** 已解析的「更多」文案。 */
	readonly moreLabel: string;
	/** 收纳在「更多」弹出菜单中的次要导航项。 */
	readonly moreNavItems: readonly SidebarNavItem[];
	readonly moreOpen: boolean;
	readonly navIndicatorBounds: NavIndicatorBounds | null;
	/** 置顶区导航项（含锁定的「新会话」，不含「更多」收纳项）。 */
	readonly navItems: readonly SidebarNavItem[];
	/** 置顶区是否还有空位（含「新会话」计数，上限 5）。 */
	readonly canPinMore: boolean;
	readonly setMoreButtonRef: RefCallback<HTMLButtonElement>;
	readonly setNavItemRef: (index: number) => RefCallback<HTMLButtonElement>;
	readonly width: number;
}

export interface SidebarThemeHost {
	readonly useSidebarModel: (input: SidebarModelInput) => SidebarModel;
}
