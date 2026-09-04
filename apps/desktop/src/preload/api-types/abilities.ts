import type { McpServerConfigData } from "./mcp.js";

/**
 * 能力安装台账（`~/.vetta/abilities.json`）：desktop 侧「装了哪些能力、什么版本」的单一索引。
 * 它只是索引不是安装位置——产物仍分别落在 skills/ scene/ plugins/、agent/mcp.json，
 * 声明受管运行时的 MCP 另有版本化运行目录（ADR-0049、ADR-0092）。
 * bundle 不进台账：其状态全部由成员派生。
 */
export type AbilityLedgerType = "skill" | "scene" | "plugin" | "mcp";

export interface GitHubMarketplaceOrigin {
	kind: "github-marketplace";
	/** 客户端配置的 Marketplace Source id；旧台账可能没有。 */
	sourceId?: string;
	marketplace: string;
	marketplaceVersion: string;
	repository: string;
}

export type AbilityInstallOrigin = { kind: "server" } | GitHubMarketplaceOrigin;

export interface AbilityLedgerEntry {
	/** 已安装到本地的版本；与市场版本比对即得「是否可更新」。 */
	version: string;
	/** 首次安装时间（ISO 8601）；重装升级不重置。 */
	installedAt: string;
	/** 安装来源；旧台账没有该字段时按服务端市场处理。 */
	origin?: AbilityInstallOrigin;
	/** 能力配置结构版本，用于后续配置迁移。 */
	configVersion?: number;
	/** 来源感知的目录标识；旧台账可能没有。 */
	catalogId?: string;
	/** 市场目录中的 slug；MCP 的台账 key 可能使用不同的 runtimeName。 */
	slug?: string;
	/** MCP 在 `mcp.json` 中实际使用的 key；仅 MCP 条目携带。 */
	runtimeName?: string;
}

export interface AbilityInstallMetadata {
	origin?: AbilityInstallOrigin;
	configVersion?: number;
	catalogId?: string;
	slug?: string;
	runtimeName?: string;
}

/** 键为 `<type>:<physical-name>`；MCP 的 physical-name 是 runtimeName。 */
export type AbilityLedger = Record<string, AbilityLedgerEntry>;

export interface OpenMarketplaceMetaEntry {
	key?: "homepage" | "repository" | "docs" | "license";
	label?: string;
	value: string;
}

export interface OpenMarketplaceShowcase {
	template: "chat-over-canvas" | "chat-thread" | "canvas-hero" | "prompt-result" | "spotlight" | "workbench";
	user_prompt: string;
	assistant_reply: string;
	canvas?: "design" | "code" | "docs" | "generic" | "browser" | "terminal" | "board";
	brand_icon_url?: string;
	brand_name?: string;
}

export interface OpenMarketplaceFeatureItem {
	title: string;
	description: string;
	icon?: string;
}

export interface OpenMarketplaceStepItem {
	title: string;
	description?: string;
}

export interface OpenMarketplaceLinkItem {
	label: string;
	href: string;
}

export interface OpenMarketplaceGalleryItem {
	src: string;
	alt?: string;
	caption?: string;
}

export interface OpenMarketplaceStatItem {
	value: string;
	label: string;
	description?: string;
}

export interface OpenMarketplaceComparisonColumn {
	title: string;
	items: string[];
	tone?: "neutral" | "accent";
}

export type OpenMarketplaceDetailBlock =
	| {
			type: "hero";
			eyebrow?: string;
			title: string;
			description?: string;
			image?: string;
			image_alt?: string;
			layout?: "split" | "stacked";
			badges?: string[];
	  }
	| { type: "feature-grid"; title?: string; items: OpenMarketplaceFeatureItem[] }
	| { type: "steps"; title?: string; items: OpenMarketplaceStepItem[] }
	| { type: "showcase"; showcase: OpenMarketplaceShowcase }
	| { type: "image"; src: string; alt?: string; caption?: string }
	| { type: "gallery"; title?: string; items: OpenMarketplaceGalleryItem[] }
	| { type: "stats"; title?: string; items: OpenMarketplaceStatItem[] }
	| {
			type: "comparison";
			title?: string;
			left: OpenMarketplaceComparisonColumn;
			right: OpenMarketplaceComparisonColumn;
	  }
	| { type: "callout"; tone: "info" | "success" | "warning"; title?: string; content: string }
	| { type: "markdown"; content: string }
	| { type: "links"; title?: string; items: OpenMarketplaceLinkItem[] };

export interface OpenMarketplaceDetailLocale {
	name?: string;
	description?: string;
	content?: string;
	showcases?: OpenMarketplaceShowcase[];
	meta?: OpenMarketplaceMetaEntry[];
	blocks?: OpenMarketplaceDetailBlock[];
}

export interface OpenMarketplaceDetail extends OpenMarketplaceDetailLocale {
	license?: string;
	author?: string;
	icon?: string;
	tags?: string[];
	i18n?: Record<string, OpenMarketplaceDetailLocale>;
}

/** 运行时聚合索引；内容来源仍是每个随应用分发能力自己的 ability.json。 */
export type BuiltinAbilityPresentations = Record<string, OpenMarketplaceDetail>;

export interface OpenMarketplaceBundleMember {
	type: "skill" | "scene" | "mcp" | "plugin";
	slug: string;
	exists: boolean;
	name: string;
	icon: string;
	version: string;
}

export interface OpenMarketplaceAbilityConfig {
	mcp?: Record<string, unknown>;
	mcp_browser_auth?: boolean;
	mcp_runtime?: {
		kind: "managed-binary";
		supported: boolean;
	};
	mcp_parameters?: Array<{
		key: string;
		label: string;
		required: boolean;
		secret: boolean;
		placeholder?: string;
		helpUrl?: string;
		valueTemplate?: string;
	}>;
	api_version?: string;
	permissions?: string[];
	commands?: string[];
	members?: OpenMarketplaceBundleMember[];
}

export interface OpenMarketplaceAbility {
	/** Derived from top-level marketplace registration; absent on older snapshots means listed. */
	listed?: boolean;
	slug: string;
	type: "skill" | "scene" | "mcp" | "plugin" | "bundle";
	name: string;
	description: string;
	license: string;
	version: string;
	configVersion: number;
	author: string;
	icon: string;
	category: string;
	/** Display labels only; category remains the stable grouping identity. */
	categoryI18n?: Record<string, string>;
	tags: string[];
	config: OpenMarketplaceAbilityConfig;
	detail: OpenMarketplaceDetail;
	origin: GitHubMarketplaceOrigin;
}

export interface OpenMarketplaceSnapshot {
	sourceId: string;
	abilities: OpenMarketplaceAbility[];
	marketplaceVersion: string | null;
	repository: string;
	syncedAt: string | null;
	stale: boolean;
	/** 刷新失败但仍返回上次可用快照时携带。 */
	error?: "sync-failed" | "auth-required" | "forbidden" | "not-found" | "rate-limited";
}

export interface MarketplaceSource {
	id: string;
	name: string;
	type: "github";
	repository: string;
	archiveUrl: string;
	ref: string;
	enabled: boolean;
	builtin: boolean;
	autoUpdate: boolean;
	priority: number;
	createdAt: string;
	updatedAt: string;
	/** Derived by the main process; the credential value is never exposed. */
	credentialConfigured?: boolean;
}

export interface AddMarketplaceSourceInput {
	repository: string;
	name?: string;
	ref?: string;
	/** Optional GitHub fine-grained token; never returned or persisted in source metadata. */
	credential?: string;
}

export interface UpdateMarketplaceSourceInput {
	name?: string;
	ref?: string;
	enabled?: boolean;
	autoUpdate?: boolean;
	/** Replace the source credential; an empty value leaves the existing credential unchanged. */
	credential?: string;
}

export interface OpenMarketplaceSourceSnapshot extends OpenMarketplaceSnapshot {
	source: MarketplaceSource;
}

export interface OpenMarketplaceCatalog {
	sources: MarketplaceSource[];
	snapshots: OpenMarketplaceSourceSnapshot[];
	abilities: OpenMarketplaceAbility[];
	failedSourceIds: string[];
}

export interface DesktopAbilitiesApi {
	/** 一次性读取全量台账；读取时会剔除实际已不存在的漂移条目。 */
	getLedger(): Promise<AbilityLedger>;
	/** 读取内置 Skill 与系统插件包自带的详情介绍，键为 `<type>:<slug>`。 */
	listBuiltinPresentations(): Promise<BuiltinAbilityPresentations>;
	/**
	 * 记录一次市场 MCP 能力的安装/升级。
	 * skill / scene / plugin 的写入由各自主进程安装流程完成，mcp 的写入路径在渲染层
	 * （整份 mcp.json 覆写），故单独开这条通道；server 不在 mcp.json 时不落账。
	 */
	recordMcpInstall(runtimeName: string, version: string, metadata?: AbilityInstallMetadata): Promise<void>;
	/** 读取 GitHub 开源能力市场；无缓存或缓存过期时会尝试同步。 */
	listOpenMarketplace(): Promise<OpenMarketplaceSnapshot>;
	/** 强制从 GitHub 刷新，失败时返回最后一次可用快照。 */
	refreshOpenMarketplace(): Promise<OpenMarketplaceSnapshot>;
	/** 聚合所有已启用来源；搜索、筛选与分页均由客户端本地完成。 */
	listOpenMarketplaces(): Promise<OpenMarketplaceCatalog>;
	/** 强制刷新所有已启用来源，单个来源失败不会中止其它来源。 */
	refreshOpenMarketplaces(): Promise<OpenMarketplaceCatalog>;
	listMarketplaceSources(): Promise<MarketplaceSource[]>;
	addMarketplaceSource(input: AddMarketplaceSourceInput): Promise<MarketplaceSource>;
	updateMarketplaceSource(id: string, input: UpdateMarketplaceSourceInput): Promise<MarketplaceSource>;
	clearMarketplaceSourceCredential(id: string): Promise<void>;
	removeMarketplaceSource(id: string): Promise<void>;
	refreshMarketplaceSource(id: string): Promise<OpenMarketplaceSourceSnapshot>;
	/** 后台同步激活新快照时触发；调用方重新读取本地目录即可。 */
	onOpenMarketplacesUpdated(handler: () => void): () => void;
	/** 从当前已校验快照安装 skill / scene / plugin；bundle 由客户端逐成员安装。 */
	installOpenAbility(type: "skill" | "scene" | "plugin", slug: string, sourceId?: string): Promise<void>;
	/** 下载并校验开源市场 MCP 的受管运行时，返回可直接写入 mcp.json 的标准 server 配置。 */
	prepareOpenMcpAbility(slug: string, sourceId?: string): Promise<McpServerConfigData>;
	/**
	 * 声明了安装后步骤的市场 MCP 能力 → 该步骤是否已完成，键为 `<sourceId>:<slug>`。
	 * 没有声明步骤的能力不出现在结果里。
	 */
	getOpenMcpSetupStatus(): Promise<Record<string, boolean>>;
	/** 删除受管 MCP 的版本化运行文件；data/cache 目录按设计保留。 */
	removeOpenMcpRuntime(slug: string, sourceId?: string): Promise<void>;
}
