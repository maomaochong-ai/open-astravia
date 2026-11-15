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
	/** 左栏「操作」格（压缩上下文等会话操作）。 */
	operations: string;
	/** 左栏底部「能力广场」入口。 */
	openAbilityPlaza: string;
	/** 左栏各分类的显示名（`title` 提示与无障碍名称）。 */
	categoryLabel: (tab: AddPanelTab) => string;
	/** 分组标题（内置 / 我的 / 项目 / 插件 / 市场 / 已接入 …）。 */
	groupLabel: (titleKey: string) => string;
	/** 空态：某一类没有条目（带分类名，说明「这一格里现在没有东西」）。 */
	categoryEmpty: (category: string) => string;
	/** 空态：当前会话没有可用的操作（压缩上下文需要已绑定会话）。 */
	operationsEmptyHint: string;
	/** 空态：搜索没有命中。 */
	emptyNoMatch: string;
	emptyNoMatchHint: string;
	/** 行内按钮。 */
	favoriteAdd: string;
	favoriteRemove: string;
	details: string;
	/** 预览页。 */
	preview: {
		back: string;
		sourceLabel: string;
		statusLabel: string;
		statusConnected: string;
		insertLabel: string;
		hintSkill: string;
		hintConnector: string;
		hintFile: string;
		hintExtension: string;
	};
	/** 底栏快捷键提示。 */
	hints: {
		navigate: string;
		insert: string;
		details: string;
		close: string;
		/** 工具行的左右切换按钮（无触控板时也要能翻）。 */
		scrollToolsLeft: string;
		scrollToolsRight: string;
		scrollRailUp: string;
		scrollRailDown: string;
	};
}

/**
 * 预览页的数据。
 *
 * 只有展示用的字段，**没有动作**：插入由「点这一行」完成，预览是「看清楚它是什么」。
 * 三栏时右栏底部那颗「插入到输入框」既与点行重复，又是面板里唯一一颗实心主色按钮，
 * 在同一块半透明表面上很扎眼。
 */
export interface CommandPanelPreviewModel {
	readonly key: string;
	readonly label: string;
	/** 「技能 · 内置」这类次级说明。 */
	readonly subtitle: string;
	readonly description?: string;
	readonly icon?: string;
	readonly iconUrl?: string;
	readonly fallbackIcon: string;
	readonly meta: readonly { readonly label: string; readonly value: string }[];
	readonly hint?: string;
}

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
	/** 键盘高亮条目的 key；鼠标悬停**不**改它（否则列表会被滚动追着跳）。 */
	activeKey: string | null;
	/**
	 * 键盘移动的序号：每次 `↑`/`↓` 递增，列表只在这个值变化时把高亮行滚进视口。
	 * 用它而不是 `activeKey`，是因为 hover 也会改高亮，两者无法从 key 本身区分。
	 */
	scrollSignal: number;
	/** 已收藏的全局键。 */
	favorites: readonly string[];
	/** 预览页内容；null 表示列表态。 */
	preview: CommandPanelPreviewModel | null;
	/** 搜索态：分组头显示分类名而不是来源。 */
	searching: boolean;
	operation?: CommandPanelOperationItem;
	actions: readonly CommandPanelActionItem[];
	labels: CommandPanelLabels;
	panelRef: React.RefObject<HTMLDivElement | null>;
	/**
	 * 面板内的键盘处理（↑↓ / Enter / Tab / Esc / ←）。
	 *
	 * 不走全局快捷键栈：编辑器在 capture 阶段就 `preventDefault`，全局栈看到
	 * `defaultPrevented` 会直接放弃，快捷键于是「按了没反应」。挂在面板自己的容器上
	 * 更可靠，也不会和编辑器抢键。
	 */
	onPanelKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
	className?: string;
	onSelectTab: (tab: AddPanelTab) => void;
	onQueryChange: (value: string) => void;
	/** 点击条目本体 = 插入 / 执行。 */
	onActivateEntry: (key: string) => void;
	/** 点击行尾「详情」= 打开整页预览。 */
	onOpenPreview: (key: string) => void;
	onClosePreview: () => void;
	onToggleFavorite: (key: string) => void;
	/** 打开能力广场首页（左栏底部入口）。 */
	onOpenAbilityPlaza?: () => void;
}

export type { AddPanelEntry, AddPanelSection, AddPanelTab };
