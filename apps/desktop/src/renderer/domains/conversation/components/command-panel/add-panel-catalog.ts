import { isRenderableImageIcon } from "@domains/abilities/lib/ability-presentation";

/**
 * 「添加面板」的目录模型：把能力条目投影成「分类 → 分组 → 条目」，供两栏面板渲染。
 *
 * 这里只做**结构投影与分组**，不判断条目该属于哪一类、也不判断它该不该出现——
 * 那些都由能力页同一套组装结果决定（见 `useAddPanelAbilityEntries` 与 ADR-0177）。
 * 命名刻意不叫 `Capability*`：本仓 `Capability` 是授权契约（`docs/capabilities/`），
 * 与「能往消息里加什么」是两件事；术语见 CONTEXT.md「添加面板」词条。
 */
export type AddPanelCategory = "files" | "skills" | "connectors" | "plugins" | "apps";

/** 左栏的一格：收藏 / 全部 / 五个分类 / 操作。 */
export type AddPanelTab = "favorites" | "all" | "operations" | AddPanelCategory;

/**
 * 分类顺序固定：最常用的在前，最不常用的在后。
 *
 * 不按数量动态排序——同一类条目每次都要在同一位置，否则用户每次打开都要重新找。
 */
export const ADD_PANEL_CATEGORY_ORDER: readonly AddPanelCategory[] = [
	"files",
	"skills",
	"connectors",
	"plugins",
	"apps",
];

/**
 * 轨道上始终按 {@link ADD_PANEL_CATEGORY_ORDER} 显示五类。
 *
 * `apps` 目前没有任何条目来源（本仓没有「应用」这种能力条目，`bundle` 也不是应用），
 * 它留在轨道上、内容区显示空态。分类位置固定比「只显示有内容的那几类」更重要：
 * 后者会让同一类在两次打开之间换位置，用户每次都要重新找。
 */

/**
 * 分类图标（16px 下必须彼此可辨）。
 *
 * 挑图标时的硬约束：形状不能撞。`code-scan` / `widget` / `widget-2` 在 16px 下都是
 * 四宫格，一排看过去像三个相同的格子——那等于没有分类。
 */
export const ADD_PANEL_CATEGORY_ICONS: Record<AddPanelCategory, string> = {
	files: "icon-[solar--paperclip-linear]",
	skills: "icon-[solar--code-linear]",
	connectors: "icon-[solar--plug-circle-linear]",
	plugins: "icon-[solar--box-linear]",
	apps: "icon-[solar--widget-linear]",
};

/** 「操作」格（压缩上下文等会话操作）：与分类同档图标。 */
export const ADD_PANEL_OPERATION_ICON = "icon-[solar--bolt-linear]";

/** 「全部」格：跨分类列出能力页有的全部条目。 */
export const ADD_PANEL_ALL_ICON = "icon-[solar--magic-stick-3-linear]";

/** 分类标题的 i18n key（与 `chat.json` 的 `slashPanel.sections.*` 对齐）。 */
export const ADD_PANEL_CATEGORY_TITLE_KEYS: Record<AddPanelCategory, string> = {
	files: "slashPanel.sections.files",
	skills: "slashPanel.sections.skills",
	connectors: "slashPanel.sections.connectors",
	plugins: "slashPanel.sections.plugins",
	apps: "slashPanel.sections.apps",
};

/**
 * 条目的图标可能是**两种东西**：iconify 名称（`solar:xxx`）或图片 URL / 包内相对路径。
 *
 * 判定直接复用能力页的 `isRenderableImageIcon`，两处不可能再分叉：早期这里用「看起来
 * 像 scheme 就是图片」的宽判定，把 `solar:magic-stick-3-bold` 当 URL 塞进 `<img>`，
 * 加载失败后落成灰色占位——面板里那片灰块就是这么来的。
 */
export function splitIcon(raw: string | undefined): { icon?: string; iconUrl?: string } {
	if (!raw) return {};
	return isRenderableImageIcon(raw) ? { iconUrl: raw } : { icon: raw };
}

/** 面板里的一行。字段足够渲染行与预览，不回传任何一类的私有数据。 */
export interface AddPanelEntry {
	readonly category: AddPanelCategory;
	/** 分类内唯一且跨刷新稳定：技能取 `type:name`，连接器取 mcp key，其余取各自的 id。 */
	readonly id: string;
	/** 全局唯一键 `${category}:${id}`，收藏与高亮都按它记。 */
	readonly key: string;
	readonly label: string;
	readonly description?: string;
	/** iconify 名称（`solar:xxx`）或 iconify class（`icon-[solar--x]`）。 */
	readonly icon?: string;
	/** 图片图标（市场技能 png、连接器预置图、插件资源 URL）。 */
	readonly iconUrl?: string;
	readonly groupId: string;
	/** 参与搜索与键盘导航；文件动作是直接动作，不参与搜索。 */
	readonly searchable: boolean;
	/**
	 * 行首图标的兜底：条目自己没有图标时用分类图标。
	 * 早期这里留空，实测整列技能都没有图标——列表看起来缺了一块。
	 */
	readonly fallbackIcon: string;
	/** 条目类型：图标兜底时用来区分「技能默认图」与「分类图」。 */
	readonly kind?: "skill" | "mcp" | "plugin" | "bundle" | "file";
}

export interface AddPanelGroup {
	readonly id: string;
	readonly titleKey: string;
	readonly entries: readonly AddPanelEntry[];
}

export interface AddPanelSection {
	readonly category: AddPanelCategory;
	readonly titleKey: string;
	readonly groups: readonly AddPanelGroup[];
}

export interface AddPanelFileActionInput {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: string;
}

/**
 * 目录的输入。
 *
 * **只有两个来源**：文件动作（面板自己持有，不由能力页管理）与已经投影好的能力条目
 * （`useAddPanelAbilityEntries` 复用能力页的 `build*Abilities()` 产出）。这里刻意不再
 * 接受「原始技能 / 连接器 / 插件 / 应用列表」——那条旧路径会让面板重新实现一遍来源判定，
 * 正是「面板与能力页不一致」的历史来源。
 */
export interface AddPanelCatalogInput {
	readonly files?: readonly AddPanelFileActionInput[];
	readonly entries?: readonly AddPanelEntry[];
}

export const ADD_PANEL_FILE_GROUP = "actions";

/** 分类内全局键：收藏、高亮、详情都按它索引。 */
export function addPanelEntryKey(category: AddPanelCategory, id: string): string {
	return `${category}:${id}`;
}

/**
 * 分组标题由 **groupId** 决定，不是由分类决定。
 *
 * 同一分类里可以同时有「内置」与「已安装」两组（系统插件与第三方插件都在 `plugins`
 * 分类下）。按分类取标题会把内置组也标成「已安装」——条目分对了、标签却错。
 * 未知 groupId 落到该分类的默认组标题。
 */
const GROUP_TITLE_KEYS: Record<string, string> = {
	actions: "slashPanel.groups.actions",
	builtin: "slashPanel.groups.builtin",
	mine: "slashPanel.groups.mine",
	project: "slashPanel.groups.project",
	plugin: "slashPanel.groups.plugin",
	market: "slashPanel.groups.market",
	connected: "slashPanel.groups.connected",
	installed: "slashPanel.groups.installed",
	other: "slashPanel.groups.other",
};

const FALLBACK_GROUP_TITLE_KEYS: Record<AddPanelCategory, string> = {
	files: "slashPanel.groups.actions",
	skills: "slashPanel.groups.other",
	connectors: "slashPanel.groups.connected",
	plugins: "slashPanel.groups.installed",
	apps: "slashPanel.groups.mine",
};

function groupTitleKey(category: AddPanelCategory, groupId: string): string {
	return GROUP_TITLE_KEYS[groupId] ?? FALLBACK_GROUP_TITLE_KEYS[category];
}

/** 按 groupId 分桶，保持首次出现顺序（面板不重排，避免两次打开之间换组）。 */
function groupEntries(entries: readonly AddPanelEntry[], category: AddPanelCategory): AddPanelGroup[] {
	const order: string[] = [];
	const buckets = new Map<string, AddPanelEntry[]>();
	for (const entry of entries) {
		let bucket = buckets.get(entry.groupId);
		if (!bucket) {
			bucket = [];
			buckets.set(entry.groupId, bucket);
			order.push(entry.groupId);
		}
		bucket.push(entry);
	}
	return order.map((groupId) => ({
		id: groupId,
		titleKey: groupTitleKey(category, groupId),
		entries: buckets.get(groupId) ?? [],
	}));
}

function buildSection(category: AddPanelCategory, entries: readonly AddPanelEntry[]): AddPanelSection {
	return {
		category,
		titleKey: ADD_PANEL_CATEGORY_TITLE_KEYS[category],
		groups: groupEntries(entries, category),
	};
}

/**
 * 构建完整目录：五个分类按固定顺序返回，**即使某类为空也保留分类本身**——
 * 左栏是固定轨道，某一类没有条目时轨道位置不能跟着消失，列表区显示空态即可。
 */
export function buildAddPanelCatalog(input: AddPanelCatalogInput): AddPanelSection[] {
	const files = (input.files ?? []).map<AddPanelEntry>((action) => ({
		category: "files",
		id: action.id,
		key: addPanelEntryKey("files", action.id),
		label: action.label,
		description: action.description,
		...splitIcon(action.icon),
		groupId: ADD_PANEL_FILE_GROUP,
		searchable: false,
		fallbackIcon: ADD_PANEL_CATEGORY_ICONS.files,
	}));

	const provided = input.entries ?? [];
	const byCategory: Record<AddPanelCategory, readonly AddPanelEntry[]> = {
		files,
		skills: provided.filter((entry) => entry.category === "skills"),
		connectors: provided.filter((entry) => entry.category === "connectors"),
		plugins: provided.filter((entry) => entry.category === "plugins"),
		apps: provided.filter((entry) => entry.category === "apps"),
	};

	return ADD_PANEL_CATEGORY_ORDER.map((category) => buildSection(category, byCategory[category]));
}

/** 目录里全部条目（按分类顺序、组内顺序）。 */
export function flattenAddPanelSections(sections: readonly AddPanelSection[]): AddPanelEntry[] {
	const entries: AddPanelEntry[] = [];
	for (const section of sections) {
		for (const group of section.groups) entries.push(...group.entries);
	}
	return entries;
}

/** 某个分类的条目（内部仍按来源分组）；分类不存在时返回 undefined。 */
export function sectionOf(
	sections: readonly AddPanelSection[],
	category: AddPanelCategory,
): AddPanelSection | undefined {
	return sections.find((section) => section.category === category);
}

/** 收藏键 → 条目，跨分类按分类顺序重新分组；收藏里有但目录里已消失的键直接丢弃。 */
export function buildFavoritesSections(
	sections: readonly AddPanelSection[],
	favorites: readonly string[],
): AddPanelSection[] {
	if (favorites.length === 0) return [];
	const wanted = new Set(favorites);
	return sections
		.map((section) => ({
			...section,
			groups: section.groups
				.map((group) => ({ ...group, entries: group.entries.filter((entry) => wanted.has(entry.key)) }))
				.filter((group) => group.entries.length > 0),
		}))
		.filter((section) => section.groups.length > 0);
}

function normalize(value: string): string {
	return value.trim().toLocaleLowerCase();
}

/**
 * 跨分类搜索：只筛 `searchable` 的条目，命中按分类顺序重新分组。
 *
 * 分组标题保留分类名而不是来源——用户此刻找的是「哪个东西叫这个名字」，
 * 告诉他它在「技能」里比在「我的」里更有用。
 */
export function searchAddPanelSections(sections: readonly AddPanelSection[], query: string): AddPanelSection[] {
	const needle = normalize(query);
	// 空搜索词返回原目录本身（调用方只在有词时走到这里，但别把 readonly 数组当可变返回）。
	if (!needle) return [...sections];
	const result: AddPanelSection[] = [];
	for (const section of sections) {
		const entries = section.groups
			.flatMap((group) => group.entries)
			.filter(
				(entry) =>
					entry.searchable &&
					(normalize(entry.label).includes(needle) || normalize(entry.description ?? "").includes(needle)),
			);
		if (entries.length === 0) continue;
		result.push({
			category: section.category,
			titleKey: section.titleKey,
			groups: [{ id: `search:${section.category}`, titleKey: section.titleKey, entries }],
		});
	}
	return result;
}

/** 列表里的一行：分组头或条目。 */
export type AddPanelRow =
	| { readonly kind: "header"; readonly id: string; readonly label: string }
	| { readonly kind: "entry"; readonly entry: AddPanelEntry };

/**
 * 把分组拍平成行（分组头 + 条目），供列表按顺序渲染。
 *
 * 分组头规则：搜索 / 「全部」视图按分类分组（标题是分类名）；分类视图里按来源分组，
 * 来源多于一个才出标题；空分组不出现。
 */
export function buildAddPanelRows(
	sections: readonly AddPanelSection[],
	options: {
		readonly searching: boolean;
		readonly categoryLabel: (category: AddPanelCategory) => string;
		readonly groupLabel: (titleKey: string) => string;
	},
): AddPanelRow[] {
	const rows: AddPanelRow[] = [];
	for (const section of sections) {
		const showCategoryHeader = options.searching;
		const showGroupHeaders = !options.searching && section.groups.length > 1;
		if (showCategoryHeader) {
			rows.push({
				kind: "header",
				id: `category:${section.category}`,
				label: options.categoryLabel(section.category),
			});
		}
		for (const group of section.groups) {
			if (group.entries.length === 0) continue;
			if (showGroupHeaders) {
				rows.push({
					kind: "header",
					id: `group:${section.category}:${group.id}`,
					label: options.groupLabel(group.titleKey),
				});
			}
			for (const entry of group.entries) rows.push({ kind: "entry", entry });
		}
	}
	return rows;
}
