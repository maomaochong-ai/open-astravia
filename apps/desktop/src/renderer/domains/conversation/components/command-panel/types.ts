import type { ContextRingViewProps } from "@astravia-org/theme-ui/chat";
import type { SkillInfo } from "@preload/api";
import type { AddPanelEntry, AddPanelSection, AddPanelTab } from "./add-panel-catalog";

export interface SkillListLabels {
	/** source → 展示用的小标签（内置 / 插件 / 场景 …）；不传则不渲染这枚 badge。 */
	sourceLabel?: (source: string) => string;
	emptyNoMatch: string;
	/** 空态卡片里的第二行提示（有过滤词但没命中）。 */
	emptyNoMatchHint: string;
	emptyNoSkills: string;
	/** 空态卡片里的第二行提示（本来就没有可用条目）。 */
	emptyNoSkillsHint: string;
}

export interface SkillListProps {
	items: readonly SkillInfo[];
	activeIndex: number;
	indexOffset?: number;
	labels: SkillListLabels;
	filtering: boolean;
	/**
	 * 本次只渲染前 N 行。展开动画期间用它把「一次性布局上百行」推到动画之后，
	 * 不传则全量渲染。
	 */
	limit?: number;
	/** 市场目录里的图标（`solar:xxx` 或图片 URL）；返回 undefined 时落默认图。 */
	resolveIcon?: (skill: SkillInfo) => string | undefined;
	onHover: (index: number) => void;
	onSelect: (skill: SkillInfo) => void;
}

export interface CommandPanelLabels extends SkillListLabels {
	/** 面板内的搜索框占位符。 */
	searchPlaceholder: string;
	clearSearch: string;
	/** 左栏「收藏」格与收藏空态标题。 */
	favorites: string;
	favoritesEmpty: string;
	favoritesEmptyHint: string;
	/** 左栏分类轨道的无障碍名称。 */
	categories: string;
	/** 左栏底部「能力广场」入口。 */
	openAbilityPlaza: string;
	/** 左栏各分类的显示名（`title` 提示与无障碍名称）。 */
	categoryLabel: (tab: AddPanelTab) => string;
	/** 分组标题（内置 / 我的 / 项目 / 插件 / 市场 / 已接入 …）。 */
	groupLabel: (titleKey: string) => string;
	/** 空态：某一类没有条目。 */
	categoryEmpty: string;
	/** 空态：搜索没有命中。 */
	emptyNoMatch: string;
	emptyNoMatchHint: string;
	/** 行内按钮。 */
	favoriteAdd: string;
	favoriteRemove: string;
	details: string;
	/** 详情栏的动作文案与提示。 */
	detail: {
		insert: string;
		execute: string;
		connect: string;
		configure: string;
		disconnect: string;
		viewPermissions: string;
		enable: string;
		disable: string;
		viewInPlaza: string;
		viewDetails: string;
		sourceLabel: string;
		statusLabel: string;
		insertLabel: string;
		hintSkill: string;
		hintConnector: string;
		hintFile: string;
		hintExtension: string;
		statusConnected: string;
		statusDisconnected: string;
		statusEnabled: string;
		statusDisabled: string;
		statusPublished: string;
		statusDraft: string;
	};
	/** 底栏快捷键提示。 */
	hints: {
		navigate: string;
		select: string;
		tab: string;
		insert: string;
		close: string;
	};
}

/** 右栏详情：文案与动作都已本地化，视图只负责排版。 */
export interface CommandPanelDetailModel {
	readonly key: string;
	readonly label: string;
	/** 「技能 · 内置」这类次级说明。 */
	readonly subtitle: string;
	readonly description?: string;
	readonly primaryIcon?: string;
	readonly primaryIconUrl?: string;
	readonly meta: readonly { readonly label: string; readonly value: string }[];
	readonly hint?: string;
	readonly primaryLabel: string;
	readonly secondaryLabel?: string;
}

/**
 * 文件区段的一行。它是直接动作（添加文件 / 添加图片 / 引用对话内文件），
 * 不是可搜索条目，因此不进列表的键盘索引。
 */
export interface CommandPanelFileAction {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: string;
	readonly onSelect: () => void;
}

export interface CommandPanelActionItem {
	id: string;
	label: string;
	icon?: React.ReactNode;
	active: boolean;
	onToggle: () => void;
}

export interface CommandPanelOperationItem {
	id: string;
	label: string;
	description: string;
	contextRing: Omit<ContextRingViewProps, "className"> | null;
	disabled: boolean;
	onSelect: () => void;
}

export interface CommandPanelProps {
	/** 展开 / 收缩：面板是输入卡片的形态切换，不是浮层节点。 */
	open: boolean;
	/** 左栏当前格。 */
	tab: AddPanelTab;
	/** 面板内搜索词（由 model 持有：键盘导航必须对可见条目工作）。 */
	query: string;
	/** 已按 tab + 搜索词过滤并分组的目录。 */
	sections: readonly AddPanelSection[];
	/** 可见条目的全局键，按渲染顺序；键盘导航与高亮都按它。 */
	visibleKeys: readonly string[];
	/** 当前高亮条目的 key。 */
	activeKey: string | null;
	/** 已收藏的全局键。 */
	favorites: readonly string[];
	/** 右栏内容；没有高亮项时为 null，整栏不渲染。 */
	detail: CommandPanelDetailModel | null;
	/** 搜索态：分组头显示分类名而不是来源。 */
	searching: boolean;
	operation?: CommandPanelOperationItem;
	actions: readonly CommandPanelActionItem[];
	labels: CommandPanelLabels;
	panelRef: React.RefObject<HTMLDivElement | null>;
	className?: string;
	onSelectTab: (tab: AddPanelTab) => void;
	onQueryChange: (value: string) => void;
	onHoverEntry: (key: string) => void;
	onActivateEntry: (key: string) => void;
	onToggleFavorite: (key: string) => void;
	/** 打开能力广场首页（左栏底部入口）。 */
	onOpenAbilityPlaza?: () => void;
	/** 打开当前条目在能力广场里的页面（详情栏次要动作）。 */
	onOpenEntryInPlaza?: () => void;
}

export type { AddPanelEntry, AddPanelSection, AddPanelTab };
