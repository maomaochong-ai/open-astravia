/**
 * 能力（Ability）统一模型（ADR-0049）。
 * 五种 type 共用一套卡片与详情呈现；物理安装仍分三轨，差异收敛在 actions 层。
 */
import type { GitHubMarketplaceOrigin, InstalledPlugin, PluginPermission } from "@preload/api";
import type { AbilityMember, AbilityType, MarketAbility } from "@shared/lib/api";
import type { McpSettingsModel } from "../settings/components/useMcpSettingsModel";
import type { BuiltinMcpPreset } from "../settings/mcp/builtin-mcp-presets";

export type AbilityScope = "discover" | "mine";

export type AbilityCatalogSource =
	| { kind: "builtin"; id: "builtin" }
	| { kind: "local"; id: "local" }
	| { kind: "server"; id: "server" }
	| { kind: "github"; id: string; name: string; repository: string };

/** 分组 key：无分类的条目归到这一组。 */
export const ABILITY_CATEGORY_UNCATEGORIZED = "__uncategorized__";

/**
 * 分组 key：内置 MCP 连接器预设（Notion/Figma/GitHub…）。
 * 客户端合成、没有服务端分类，展示名走 i18n（`abilities:group.connectors`）而非 `categoryI18n`。
 */
export const ABILITY_CATEGORY_CONNECTORS = "__connectors__";

/**
 * 分组 key：随 App 分发的内置能力（`isBuiltin`：skill-presets、通用 Agent、系统插件）。
 * 与用户自己安装的能力（市场 / `~/.agents/skills`）分开成组，展示名走
 * `abilities:group.vettaBuiltin`。
 */
export const ABILITY_CATEGORY_VETTA_BUILTIN = "__vetta_builtin__";

export interface AbilityBase {
	/** 来源感知的目录唯一标识；同 type + slug 可以跨来源并存。 */
	id: string;
	slug: string;
	catalogSource: AbilityCatalogSource;
	title: string;
	description: string;
	/** 已解析的图标值：空 / `solar:xxx` / 绝对 URL / `vetta-plugin://…`。 */
	icon?: string;
	/** 分类的规范名；未分类为空串。它是分组与筛选的 key，展示名另见 `categoryI18n`。 */
	category: string;
	/** 分类译名，展示时取 `categoryI18n[locale] ?? category`；仅市场条目带。 */
	categoryI18n?: Record<string, string>;
	tags: string[];
	author: string;
	license: string;
	/** 市场版本；无市场行时退回本地版本。 */
	version: string;
	/** 台账（或本地清单）记录的已安装版本。 */
	localVersion?: string;
	/** 产物摘要，安装前校验；mcp / bundle 恒为空。 */
	sha256?: string;
	installed: boolean;
	enabled: boolean;
	/** 内置 / 通用 Agent 等只读能力：不可安装、卸载、启停。 */
	readonly: boolean;
	needsUpdate: boolean;
	/** 缺凭证或未授权，装了也用不了。 */
	setupRequired: boolean;
	busy: boolean;
	downloadCount: number;
	/** 用户自行导入（本地 zip / 从路径安装）。 */
	isCustom: boolean;
	/** 随 App 分发的内置能力（skill-presets、系统插件）。 */
	isBuiltin: boolean;
	/** 是否有对应的市场行。 */
	fromMarket: boolean;
	/** 仅 GitHub 开源市场能力携带；服务端市场与本地能力为空。 */
	origin?: GitHubMarketplaceOrigin;
	market?: MarketAbility;
	/** 同类型、同展示名或同 slug 的其它目录条目。 */
	sameNameIds?: string[];
	/** 已占用同一物理安装位置的其它来源条目；显式替换流程完成前禁止覆盖。 */
	installConflictIds?: string[];
	searchTerms: string[];
}

export interface SkillAbility extends AbilityBase {
	type: "skill" | "scene";
	/** listSkills 的来源标识（`agents-user` / `builtin` 等）。 */
	skillSource?: string;
}

export interface McpAbility extends AbilityBase {
	type: "mcp";
	/** mcp.json 里的 key。 */
	serverName: string;
	preset?: BuiltinMcpPreset;
	/** bundle 私有内联成员的配置：安装时原样写入 mcpServers[serverName]。 */
	inlineConfig?: Record<string, unknown>;
	usesOAuth: boolean;
	authorized: boolean;
	canConfigure: boolean;
	canEdit: boolean;
}

export interface PluginAbility extends AbilityBase {
	type: "plugin";
	plugin: InstalledPlugin | null;
	/**
	 * 插件声明的工作模式白名单（agent_mode 轴，ADR-0046），已归一化为数组；
	 * 空数组 = 通用（全部模式可用）。未安装的市场条目无此信息，恒为空数组。
	 */
	agentModes: string[];
	/** manifest 声明的权限（未装时取市场快照）。 */
	permissions: PluginPermission[];
	grantedPermissions: PluginPermission[];
	commands: string[];
	grantedCommands: string[];
	pendingVersion?: string;
}

export interface BundleAbility extends AbilityBase {
	type: "bundle";
	members: AbilityMember[];
	/** 已在本地解析出的成员条目；引用不存在时缺项。 */
	memberItems: AbilityItem[];
}

export type AbilityItem = SkillAbility | McpAbility | PluginAbility | BundleAbility;

/** 列表分组：按能力分类聚合，`category` 为 `ABILITY_CATEGORY_UNCATEGORIZED` 时表示未分类。 */
export interface AbilityGroup {
	/** 规范名（或 `ABILITY_CATEGORY_UNCATEGORIZED`），分组 key。 */
	category: string;
	/** 该分类的译名块，渲染分组标题时按 locale 取。 */
	categoryI18n?: Record<string, string>;
	items: AbilityItem[];
}

/** Banner 轮播图标源（与「发现」列表同源）。 */
export interface AbilityBannerIcon {
	id: string;
	/** 无图时按 type 落默认图。 */
	type: AbilityType;
	icon?: string;
}

export interface AbilitiesModel {
	scope: AbilityScope;
	setScope: (scope: AbilityScope) => void;
	searchQuery: string;
	setSearchQuery: (value: string) => void;
	/** 经 scope + 搜索过滤后的结果。 */
	items: AbilityItem[];
	/** 经 scope + 搜索过滤后的总数；items 只包含当前已展开的本地分页。 */
	totalItems: number;
	hasMore: boolean;
	loadMore: () => void;
	/** items 按分类聚合；分类名升序，未分类置底。 */
	groups: AbilityGroup[];
	/** 未经任何过滤的全集，供详情页按 id 查找。 */
	allItems: AbilityItem[];
	bannerIcons: AbilityBannerIcon[];
	loading: boolean;
	refreshing: boolean;
	errors: string[];
	/** 详情页只展示当前操作错误，不继承列表级来源加载错误。 */
	detailErrors: string[];
	importing: boolean;
	mcp: McpSettingsModel;
	findById: (id: string) => AbilityItem | null;
	refresh: () => void;
	install: (item: AbilityItem) => void;
	/** 安装 bundle 时只处理用户勾选的成员。 */
	installBundleMembers: (bundle: BundleAbility, members: AbilityItem[]) => void;
	uninstall: (item: AbilityItem) => void;
	toggle: (item: AbilityItem) => void;
	setup: (item: McpAbility) => void;
	configure: (item: McpAbility) => void;
	edit: (item: McpAbility) => void;
	revokeAuthorization: (item: McpAbility) => void;
	setPluginPermission: (item: PluginAbility, permission: PluginPermission, granted: boolean) => void;
	/** 装完那次的启用 + 权限一起落盘：草稿在弹窗里攒着，点确认才走到这里。 */
	applyPluginSetup: (item: PluginAbility, next: { enabled: boolean; grantedPermissions: PluginPermission[] }) => void;
	setPluginCommand: (item: PluginAbility, command: string, granted: boolean) => void;
	reloadPlugin: (item: PluginAbility) => void;
	/** 逐项勾选后卸载 bundle 成员。 */
	uninstallBundleMembers: (members: AbilityItem[]) => void;
	importSkillArchive: (file: File) => void;
	importPluginArchive: (file: File) => void;
	startAddManualMcp: () => void;
	/** 刚装好、待提示配置权限的插件 slug；为空表示不提示。 */
	permissionPromptSlug: string | null;
	dismissPermissionPrompt: () => void;
}
