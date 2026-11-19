import { isRenderableImageIcon } from "@domains/abilities/lib/ability-presentation";

/**
 * 「添加面板」的目录模型：把能力条目投影成「分类 → 分组 → 条目」，供两栏面板渲染。
 *
 * 这里只做**结构投影与分组**，不判断条目该属于哪一类、也不判断它该不该出现——
 * 那些都由能力页同一套组装结果决定（见 `useAddPanelAbilityEntries` 与 ADR-0177）。
 * 命名刻意不叫 `Capability*`：本仓 `Capability` 是授权契约（`docs/capabilities/`），
 * 与「能往消息里加什么」是两件事；术语见 CONTEXT.md「添加面板」词条。
 */
export type AddPanelCategory = "skill" | "plugin" | "mcp" | "bundle";

/** 来源视图：内置 / 市场（与「全部」同属「按来源看」的维度，不是条目类型）。 */
export type AddPanelProvenanceTab = "builtin" | "market";

export type AddPanelTab = "favorites" | "all" | "operations" | AddPanelProvenanceTab | AddPanelCategory;

/**
 * 分类顺序固定：最常用的在前，最不常用的在后。
 *
 * 不按数量动态排序——同一类条目每次都要在同一位置，否则用户每次打开都要重新找。
 */
export const ADD_PANEL_CATEGORY_ORDER: readonly AddPanelCategory[] = ["skill", "plugin", "mcp", "bundle"];

/**
 * 分类图标（16px 下必须彼此可辨）。
 *
 * 挑图标时的硬约束：形状不能撞。`code-scan` / `widget` / `widget-2` 在 16px 下都是
 * 四宫格，一排看过去像三个相同的格子——那等于没有分类。
 */
export const ADD_PANEL_CATEGORY_ICONS: Record<AddPanelCategory, string> = {
	skill: "icon-[solar--code-linear]",
	mcp: "icon-[solar--plug-circle-linear]",
	plugin: "icon-[solar--box-linear]",
	bundle: "icon-[solar--widget-linear]",
};

/** 「指令」格（压缩上下文等会话操作）：与分类同档图标。 */
export const ADD_PANEL_COMMAND_ICON = "icon-[solar--bolt-linear]";

/** 「全部」格：跨分类列出能力页有的全部条目。 */
export const ADD_PANEL_ALL_ICON = "icon-[solar--magic-stick-3-linear]";

/** 分类标题的 i18n key（与 `chat.json` 的 `slashPanel.sections.*` 对齐）。 */
export const ADD_PANEL_CATEGORY_TITLE_KEYS = {
	skill: "slashPanel.sections.skills",
	plugin: "slashPanel.sections.plugins",
	mcp: "slashPanel.sections.mcp",
	bundle: "slashPanel.sections.bundle",
} as const satisfies Record<AddPanelCategory, string>;

/** 来源视图的图标：内置（仓库/盒子）与市场（店铺/货架）。 */
export const ADD_PANEL_PROVENANCE_ICONS: Record<AddPanelProvenanceTab, string> = {
	builtin: "icon-[solar--archive-linear]",
	market: "icon-[solar--cart-large-2-linear]",
};

/** 来源视图的标题 key（对齐 `slashPanel.groups.*` 里已存在的「内置」「市场」）。 */
export const ADD_PANEL_PROVENANCE_TITLE_KEYS = {
	builtin: "slashPanel.groups.builtin",
	market: "slashPanel.groups.market",
} as const satisfies Record<AddPanelProvenanceTab, string>;

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
	/**
	 * 能否插入到消息里。
	 *
	 * 内置能力随 App 分发，对话里本来就直接可用——再提供一次「插入」只会让人误以为
	 * 需要先插进去才生效。它们留在列表里是因为用户要能看见「我本来就有这些」，
	 * 但行不响应点击、键盘导航也跳过。
	 */
	readonly insertable: boolean;
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
	agents: "slashPanel.groups.agents",
	mine: "slashPanel.groups.mine",
	project: "slashPanel.groups.project",
	plugin: "slashPanel.groups.plugin",
	market: "slashPanel.groups.market",
	connected: "slashPanel.groups.connected",
	installed: "slashPanel.groups.installed",
	other: "slashPanel.groups.other",
};

const FALLBACK_GROUP_TITLE_KEYS: Record<AddPanelCategory, string> = {
	skill: "slashPanel.groups.other",
	mcp: "slashPanel.groups.connected",
	plugin: "slashPanel.groups.installed",
	bundle: "slashPanel.groups.mine",
};

function groupTitleKey(category: AddPanelCategory, groupId: string): string {
	return GROUP_TITLE_KEYS[groupId] ?? FALLBACK_GROUP_TITLE_KEYS[category];
}

/**
 * 分组展示顺序固定：来源从「随 App 分发」到「用户自己的」。
 *
 * 不按条目首次出现排序——那样同一分类里「市场」和「我的」的先后会随条目名的字母序变化，
 * 每次打开都可能换位置。
 */
const GROUP_ORDER: readonly string[] = [
	"builtin",
	"market",
	"plugin",
	"agents",
	"connected",
	"installed",
	"project",
	"mine",
	"other",
];

function groupRank(groupId: string): number {
	const index = GROUP_ORDER.indexOf(groupId);
	return index === -1 ? GROUP_ORDER.length : index;
}

/** 按 groupId 分桶，按 {@link GROUP_ORDER} 排列（未知来源排在最后）。 */
function groupEntries(entries: readonly AddPanelEntry[], category: AddPanelCategory): AddPanelGroup[] {
	const buckets = new Map<string, AddPanelEntry[]>();
	for (const entry of entries) {
		const bucket = buckets.get(entry.groupId);
		if (bucket) bucket.push(entry);
		else buckets.set(entry.groupId, [entry]);
	}
	return [...buckets.keys()]
		.sort((left, right) => groupRank(left) - groupRank(right))
		.map((groupId) => ({
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
	const provided = input.entries ?? [];
	const byCategory: Record<AddPanelCategory, readonly AddPanelEntry[]> = {
		skill: provided.filter((entry) => entry.category === "skill"),
		mcp: provided.filter((entry) => entry.category === "mcp"),
		plugin: provided.filter((entry) => entry.category === "plugin"),
		bundle: provided.filter((entry) => entry.category === "bundle"),
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

/**
 * 按来源筛条目：只保留 `groupId` 等于目标来源的分组，其余丢弃。
 *
 * 「内置」视图 = 随 App 分发的内置能力（`groupId === "builtin"`）；
 * 「市场」视图 = 从市场安装的能力（`groupId === "market"`）。
 *
 * 命中的条目并回一个分组、标题改用分类名：这个视图里「来源」已是筛选条件，
 * 每组再标一次「市场」只会得到几个同名分组，用户反而分不清哪组是技能、哪组是插件。
 */
export function filterByProvenance(
	sections: readonly AddPanelSection[],
	provenance: AddPanelProvenanceTab,
): AddPanelSection[] {
	const result: AddPanelSection[] = [];
	for (const section of sections) {
		const entries = section.groups.filter((group) => group.id === provenance).flatMap((group) => group.entries);
		if (entries.length === 0) continue;
		result.push({ ...section, groups: [{ id: provenance, titleKey: section.titleKey, entries }] });
	}
	return result;
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

/** 列表里的一行：分组头或条目。分组头带条目数量。 */
export type AddPanelRow =
	| { readonly kind: "header"; readonly id: string; readonly label: string; readonly count: number }
	| { readonly kind: "entry"; readonly entry: AddPanelEntry };

/**
 * 把分组拍平成行（分组头 + 条目），供列表按顺序渲染。
 *
 * 分组头规则：搜索 / 「全部」/ 来源视图按分类分组（标题是分类名）；分类视图里按来源分组，
 * 标题带该组条数；空分组不出现。
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
		// 浏览态一律出分组头：用户要靠标题上的数量判断「这一类里各来源各有多少」。
		const showGroupHeaders = !options.searching;
		// 分组头的数字是「这一组有几条」；搜索态按分类分组，所以是整类条数。
		const sectionCount = section.groups.reduce((total, group) => total + group.entries.length, 0);
		if (showCategoryHeader) {
			rows.push({
				kind: "header",
				id: `category:${section.category}`,
				label: options.categoryLabel(section.category),
				count: sectionCount,
			});
		}
		for (const group of section.groups) {
			if (group.entries.length === 0) continue;
			if (showGroupHeaders) {
				rows.push({
					kind: "header",
					id: `group:${section.category}:${group.id}`,
					label: options.groupLabel(group.titleKey),
					count: group.entries.length,
				});
			}
			for (const entry of group.entries) rows.push({ kind: "entry", entry });
		}
	}
	return rows;
}
