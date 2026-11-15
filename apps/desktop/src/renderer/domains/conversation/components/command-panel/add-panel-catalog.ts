import type { SkillInfo } from "@preload/api";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";

/**
 * 「添加面板」的能力目录：把五类可添加到当前消息的条目投影成
 * 「分类 → 分组 → 条目」，供两栏面板（分类轨道 + 列表）渲染。
 *
 * 这里只做投影与排序，不碰任何一类的存储、权限与安装路径——技能来自 `SkillInfo[]`、
 * 连接器来自 `ConnectorGridItem[]`、插件/应用来自能力注册表、文件来自工具行的附件动作。
 * 命名刻意不叫 `Capability*`：本仓 `Capability` 是授权契约（`docs/capabilities/`），
 * 与「能往消息里加什么」是两件事；术语见 CONTEXT.md「添加面板」词条。
 */
export type AddPanelCategory = "files" | "skills" | "connectors" | "plugins" | "apps";

/** 左栏的一格：收藏 + 五个分类。 */
export type AddPanelTab = "favorites" | "operations" | AddPanelCategory;

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
 * `plugins` 与 `apps` 目前拿不到条目（能力注册表没有暴露「已安装插件 / 我的应用」的
 * 读取接口）——它们仍然留在轨道上，内容区显示分类空态。分类位置固定比「只显示有内容的
 * 那几类」更重要：后者会让同一类在两次打开之间换位置，用户每次都要重新找。
 */

/**
 * 分类图标（16px 下必须彼此可辨）。
 *
 * 挑图标时的硬约束：形状不能撞。`code-scan` / `widget` / `widget-2` 在 16px 下都是
 * 四宫格，一排看过去像三个相同的格子——那等于没有分类。
 */
export const ADD_PANEL_OPERATION_ICON = "icon-[solar--bolt-linear]";

export const ADD_PANEL_CATEGORY_ICONS: Record<AddPanelCategory, string> = {
	files: "icon-[solar--paperclip-linear]",
	skills: "icon-[solar--magic-stick-3-linear]",
	connectors: "icon-[solar--plug-circle-linear]",
	plugins: "icon-[solar--box-linear]",
	apps: "icon-[solar--widget-linear]",
};

/**
 * 条目的图标可能是**两种东西**：iconify class（`icon-[solar--x]`）或图片路径/URL
 * （技能市场里那张 png、连接器预置图）。以前只有在连接器上区分了图片，技能带回来的
 * png 被当成 class 塞进 `<span>`，整列技能因此显示空白——实测就是这个表现。
 *
 * 在投影时就拆开，视图只认 `icon`（class）与 `iconUrl`（图片），不再靠字符串格式猜。
 */
export function splitIcon(raw: string | undefined): { icon?: string; iconUrl?: string } {
	if (!raw) return {};
	// 判定要宽一点：技能的图标可能是 `./skills/x.png`、`https://…`、
	// `astravia-media://…`、插件资源 URL，也可能带查询串（`?v=1.2&reload=…`）。
	const isScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith("icon-");
	const isPath = raw.startsWith("./") || raw.startsWith("/") || raw.includes("/skills/");
	const isImageExt = /\.(png|jpe?g|svg|webp|gif|avif)(\?|#|$)/i.test(raw);
	const isImage = isScheme || isPath || isImageExt;
	return isImage ? { iconUrl: raw } : { icon: raw };
}

/** 分类标题的 i18n key（与 `chat.json` 的 `slashPanel.sections.*` 对齐）。 */
export const ADD_PANEL_CATEGORY_TITLE_KEYS: Record<AddPanelCategory, string> = {
	files: "slashPanel.sections.files",
	skills: "slashPanel.sections.skills",
	connectors: "slashPanel.sections.connectors",
	plugins: "slashPanel.sections.plugins",
	apps: "slashPanel.sections.apps",
};

/** 面板里的一行。字段足够渲染行与预览，不回传任何一类的私有数据。 */
export interface AddPanelEntry {
	readonly category: AddPanelCategory;
	/** 分类内唯一且跨刷新稳定：技能取 `type:name`，连接器取 mcp key，其余取各自的 id。 */
	readonly id: string;
	/** 全局唯一键 `${category}:${id}`，收藏与高亮都按它记。 */
	readonly key: string;
	readonly label: string;
	readonly description?: string;
	/** iconify class（技能 / 文件动作）。 */
	readonly icon?: string;
	/** 图片图标（连接器预置图、市场里那张 png）。 */
	readonly iconUrl?: string;
	readonly groupId: string;
	/** 参与搜索与键盘导航；文件动作是直接动作，不参与搜索。 */
	readonly searchable: boolean;
	/**
	 * 行首图标的兜底：条目自己没有图标（技能没声明、连接器没有预置图）时用分类图标。
	 * 以前这里留空，实测整列技能都没有图标——列表看起来缺了一块。
	 */
	readonly fallbackIcon: string;
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

export interface AddPanelPluginEntry {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: string;
}

export interface AddPanelAppEntry {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: string;
	/** 已下线 / 未发布的应用仍然列出来，但要标明状态。 */
	readonly status?: "published" | "unpublished" | "never";
}

export interface AddPanelFileActionInput {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: string;
}

export interface AddPanelCatalogInput {
	readonly files?: readonly AddPanelFileActionInput[];
	readonly skills?: readonly SkillInfo[];
	readonly connectors?: readonly ConnectorGridItem[];
	readonly plugins?: readonly AddPanelPluginEntry[];
	readonly apps?: readonly AddPanelAppEntry[];
	/** 技能的展示图标（市场目录图 → Solar 预设 → 默认图由调用方决定）。 */
	readonly resolveSkillIcon?: (skill: SkillInfo) => string | undefined;
}

/** 技能按来源分组。分组比分类更细，但数量固定，不会随条目增长。 */
const SKILL_GROUPS: Record<string, { id: string; titleKey: string }> = {
	builtin: { id: "builtin", titleKey: "slashPanel.groups.builtin" },
	custom: { id: "mine", titleKey: "slashPanel.groups.mine" },
	user: { id: "mine", titleKey: "slashPanel.groups.mine" },
	agentsUser: { id: "mine", titleKey: "slashPanel.groups.mine" },
	path: { id: "mine", titleKey: "slashPanel.groups.mine" },
	project: { id: "project", titleKey: "slashPanel.groups.project" },
	agentsProject: { id: "project", titleKey: "slashPanel.groups.project" },
	plugin: { id: "plugin", titleKey: "slashPanel.groups.plugin" },
	market: { id: "market", titleKey: "slashPanel.groups.market" },
};

/**
 * 未知来源单独归「其他」，**不冒充「我的」**。
 *
 * `source` 是技能发现链路给出的字符串。能力市场以后新增来源（新安装渠道、新 provider
 * 类型）时，这里会先落到「其他」——分类可能不够漂亮，但不会像以前那样把别人的技能
 * 说成用户自己的。加新来源时补一条 `SKILL_GROUPS` 映射即可，未补也不会丢条目。
 */
const UNKNOWN_SKILL_GROUP = { id: "other", titleKey: "slashPanel.groups.other" };
const FILE_GROUP = { id: "actions", titleKey: "slashPanel.groups.actions" };
const CONNECTOR_GROUP = { id: "connected", titleKey: "slashPanel.groups.connected" };
const PLUGIN_GROUP = { id: "installed", titleKey: "slashPanel.groups.installed" };
const APP_GROUP = { id: "mine", titleKey: "slashPanel.groups.mine" };

export function addPanelEntryKey(category: AddPanelCategory, id: string): string {
	return `${category}:${id}`;
}

/**
 * 技能归属：**优先结构化 `provenance`，回退到旧 `source` 字符串**。
 *
 * `source` 是历史字段，取值随发现链路变化（`agents-user`、`path`、未来还会有新值）；
 * `provenance` 是带上 `kind` 与 `providerType` 的结构化描述，能区分「内置提供方」
 * 「插件提供」「原生目录」。有新字段时不该继续靠字符串猜（ADR-0177 §1/§2）。
 */
function skillGroupOf(skill: SkillInfo): { id: string; titleKey: string } {
	const provenance = skill.provenance;
	if (provenance) {
		if (provenance.kind === "builtin") return SKILL_GROUPS.builtin ?? UNKNOWN_SKILL_GROUP;
		if (provenance.kind === "provided") {
			// 插件提供的技能归「插件」；sdk / runtime 提供方与插件同列——对用户来说都是
			// 「由某个扩展贡献的能力」，没有区分的必要。
			return SKILL_GROUPS.plugin ?? UNKNOWN_SKILL_GROUP;
		}
		if (provenance.kind === "native") {
			// 原生目录的 scope 可能是目录类型（`path` / `agents-user`），也可能是安装渠道
			// （`market` / `custom`，由主进程按清单写入）。**统一走映射表**，
			// 不要在这里把「非 project」一律折叠成「我的」——那会把市场装的技能吞掉。
			return SKILL_GROUPS[provenance.scope] ?? UNKNOWN_SKILL_GROUP;
		}
	}
	return SKILL_GROUPS[skill.source] ?? UNKNOWN_SKILL_GROUP;
}

function groupEntries(entries: readonly AddPanelEntry[], titleKeyOf: (groupId: string) => string): AddPanelGroup[] {
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
		titleKey: titleKeyOf(groupId),
		entries: buckets.get(groupId) ?? [],
	}));
}

function buildSection(
	category: AddPanelCategory,
	entries: readonly AddPanelEntry[],
	titleKeyOf: (groupId: string) => string,
): AddPanelSection {
	return {
		category,
		titleKey: ADD_PANEL_CATEGORY_TITLE_KEYS[category],
		groups: groupEntries(entries, titleKeyOf),
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
		groupId: FILE_GROUP.id,
		searchable: false,
		fallbackIcon: ADD_PANEL_CATEGORY_ICONS.files,
	}));

	const skills = (input.skills ?? []).map<AddPanelEntry>((skill) => {
		const group = skillGroupOf(skill);
		const id = `${skill.type}:${skill.name}`;
		return {
			category: "skills",
			id,
			key: addPanelEntryKey("skills", id),
			label: skill.alias || skill.name,
			description: skill.description,
			...splitIcon(input.resolveSkillIcon?.(skill) ?? skill.icon),
			groupId: group.id,
			searchable: true,
			fallbackIcon: ADD_PANEL_CATEGORY_ICONS.skills,
		};
	});

	const connectors = (input.connectors ?? []).map<AddPanelEntry>((connector) => ({
		category: "connectors",
		id: connector.name,
		key: addPanelEntryKey("connectors", connector.name),
		label: connector.label,
		iconUrl: connector.iconUrl,
		groupId: CONNECTOR_GROUP.id,
		searchable: true,
		fallbackIcon: ADD_PANEL_CATEGORY_ICONS.connectors,
	}));

	const plugins = (input.plugins ?? []).map<AddPanelEntry>((plugin) => ({
		category: "plugins",
		id: plugin.id,
		key: addPanelEntryKey("plugins", plugin.id),
		label: plugin.label,
		description: plugin.description,
		...splitIcon(plugin.icon),
		groupId: PLUGIN_GROUP.id,
		searchable: true,
		fallbackIcon: ADD_PANEL_CATEGORY_ICONS.plugins,
	}));

	const apps = (input.apps ?? []).map<AddPanelEntry>((app) => ({
		category: "apps",
		id: app.id,
		key: addPanelEntryKey("apps", app.id),
		label: app.label,
		description: app.description,
		...splitIcon(app.icon),
		groupId: APP_GROUP.id,
		searchable: true,
		fallbackIcon: ADD_PANEL_CATEGORY_ICONS.apps,
	}));

	const titleKeyOf: Record<AddPanelCategory, (groupId: string) => string> = {
		files: () => FILE_GROUP.titleKey,
		skills: (groupId) =>
			[...Object.values(SKILL_GROUPS), UNKNOWN_SKILL_GROUP].find((group) => group.id === groupId)?.titleKey ??
			UNKNOWN_SKILL_GROUP.titleKey,
		connectors: () => CONNECTOR_GROUP.titleKey,
		plugins: () => PLUGIN_GROUP.titleKey,
		apps: () => APP_GROUP.titleKey,
	};

	const byCategory: Record<AddPanelCategory, readonly AddPanelEntry[]> = {
		files,
		skills,
		connectors,
		plugins,
		apps,
	};

	return ADD_PANEL_CATEGORY_ORDER.map((category) =>
		buildSection(category, byCategory[category], titleKeyOf[category]),
	);
}

/** 目录里全部条目（按分类顺序、组内顺序）。 */
export function flattenAddPanelSections(sections: readonly AddPanelSection[]): AddPanelEntry[] {
	const entries: AddPanelEntry[] = [];
	for (const section of sections) {
		for (const group of section.groups) entries.push(...group.entries);
	}
	return entries;
}

/** 某个分类的条目（内部仍按来源分组）；分类不存在时返回空数组。 */
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
export function searchAddPanelSections(
	sections: readonly AddPanelSection[],
	query: string,
): readonly AddPanelSection[] {
	const needle = normalize(query);
	// 无查询时原样返回同一个引用：调用方据此判断「有没有真的过滤过」。
	if (!needle) return sections;
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
 * 分组头规则：搜索态按分类分组（标题是分类名）；分类视图里按来源分组，来源多于一个
 * 才出标题；空分组不出现。
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
			for (const entry of group.entries) {
				rows.push({ kind: "entry", entry });
			}
		}
	}
	return rows;
}
