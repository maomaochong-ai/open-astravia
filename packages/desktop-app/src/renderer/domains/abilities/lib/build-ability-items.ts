/**
 * 市场行 + 本地状态 → AbilityItem。全部为纯函数，便于单独推理与测试。
 * installed / localVersion / needsUpdate 一律以安装台账为准（ADR-0049），
 * enabled 才回各自运行时读（skills 清单 / mcp.json / 插件注册表）。
 */
import type {
	AbilityLedger,
	AbilityLedgerEntry,
	InstalledPlugin,
	InstalledSkill,
	McpConfigData,
	McpServerConfigData,
	PluginPermission,
	SkillInfo,
} from "@preload/api";
import type { AbilityMember, MarketAbility } from "@shared/lib/api";
import { builtinSkillIconUrl } from "@shared/lib/builtin-skill-icons";
import type { TFunction } from "i18next";
import {
	type BuiltinMcpPreset,
	getListedBuiltinMcpPresets,
	isBuiltinMcpServer,
	matchBuiltinMcpPreset,
	missingRequiredSecrets,
	presetUsesOAuth,
	resolveMcpIcon,
	resolveMcpPresetDescription,
	resolveMcpPresetDisplayName,
	resolveMcpPresetIconUrl,
	serverUsesOAuth,
} from "../../settings/mcp/builtin-mcp-presets";
import {
	ABILITY_CATEGORY_CONNECTORS,
	type AbilityCatalogSource,
	type AbilityItem,
	type BundleAbility,
	type McpAbility,
	type PluginAbility,
	type SkillAbility,
} from "../types";
import { buildMarketAbilityId, getMarketCatalogSource, getOpenCatalogOrigin } from "./merge-ability-catalogs";

/**
 * 解析插件 manifest 里的 `%key%` NLS 占位符（ADR-0033）。已装插件走它自带的
 * catalog（第三参，来自 InstalledPlugin）；未装的市场条目没有 catalog，回落为裸
 * key —— 那种情况由服务端在上传时就把占位符解析成真实文案来兜底，客户端这里不做
 * 二次猜测。
 */
export type PluginTextResolver = (
	pluginId: string,
	raw: string | undefined,
	catalog?: { locales: InstalledPlugin["locales"]; defaultLocale: string },
) => string;

export interface LocalAbilityState {
	ledger: AbilityLedger;
	skillManifest: Record<string, InstalledSkill>;
	localSkills: SkillInfo[];
	plugins: InstalledPlugin[];
	mcpConfig: McpConfigData | null;
	oauthAuthByName: Record<string, boolean>;
	busyIds: ReadonlySet<string>;
}

const BUILTIN_SOURCE: AbilityCatalogSource = { kind: "builtin", id: "builtin" };
const LOCAL_SOURCE: AbilityCatalogSource = { kind: "local", id: "local" };

function abilityId(type: string, slug: string, source: AbilityCatalogSource = LOCAL_SOURCE): string {
	return `${source.kind}:${source.id}:${type}:${slug}`;
}

function physicalLedgerKey(type: string, physicalName: string): string {
	return `${type}:${physicalName}`;
}

function originsMatchSource(entry: AbilityLedgerEntry, source: AbilityCatalogSource): boolean {
	if (source.kind === "github") {
		if (entry.origin?.kind !== "github-marketplace") return false;
		if (entry.origin.sourceId) return entry.origin.sourceId === source.id;
		return entry.origin.repository === source.repository;
	}
	return source.kind === "server" && (!entry.origin || entry.origin.kind === "server");
}

function ledgerEntryMatchesCatalog(
	entry: AbilityLedgerEntry | undefined,
	catalogId: string,
	source: AbilityCatalogSource,
): entry is AbilityLedgerEntry {
	if (!entry) return false;
	if (entry.catalogId) return entry.catalogId === catalogId;
	return originsMatchSource(entry, source);
}

function catalogSourceFromLedger(entry: AbilityLedgerEntry | undefined): AbilityCatalogSource {
	if (entry?.origin?.kind === "github-marketplace") {
		return {
			kind: "github",
			id: entry.origin.sourceId ?? entry.origin.repository,
			name: entry.origin.sourceId ?? entry.origin.marketplace,
			repository: entry.origin.repository,
		};
	}
	return entry?.origin?.kind === "server" ? { kind: "server", id: "server" } : LOCAL_SOURCE;
}

function terms(...values: Array<string | undefined | string[]>): string[] {
	const out: string[] = [];
	for (const value of values) {
		if (!value) continue;
		if (Array.isArray(value)) out.push(...value.filter(Boolean));
		else out.push(value);
	}
	return out;
}

// ─── skill / scene ───

/** 清单条目的类型，缺省按 skill 处理（早期条目没有 type 字段）。 */
function manifestType(entry: InstalledSkill): "skill" | "scene" {
	return entry.type === "scene" ? "scene" : "skill";
}

export function buildSkillAbilities(market: MarketAbility[], state: LocalAbilityState): SkillAbility[] {
	const { ledger, skillManifest, localSkills, busyIds } = state;
	const items: SkillAbility[] = [];
	const seen = new Set<string>();
	/** 已由市场行 / 本地清单认领的 `type:name`：listSkills 会把它们再列一遍，不能重复建条目。 */
	const claimedNames = new Set<string>();

	for (const entry of market) {
		if (entry.type !== "skill" && entry.type !== "scene") continue;
		const catalogSource = getMarketCatalogSource(entry);
		const id = buildMarketAbilityId(entry);
		// 本地清单是扁平 map（skill 与 scene 同命名空间），同名不同类型不能互相认领
		const localEntry = skillManifest[entry.slug];
		const local = localEntry && manifestType(localEntry) === entry.type ? localEntry : undefined;
		const ledgerEntry = ledger[physicalLedgerKey(entry.type, entry.slug)];
		const installed =
			Boolean(local) &&
			(ledgerEntryMatchesCatalog(ledgerEntry, id, catalogSource) ||
				(!ledgerEntry && local?.source === "market" && catalogSource.kind === "server"));
		const localVersion = installed ? (ledgerEntry?.version ?? local?.version) : undefined;
		seen.add(id);
		if (installed) claimedNames.add(`${entry.type}:${entry.slug}`);
		items.push({
			type: entry.type,
			id,
			slug: entry.slug,
			catalogSource,
			title: entry.name || entry.slug,
			description: entry.description,
			icon: entry.icon || undefined,
			category: entry.category,
			categoryI18n: entry.category_i18n,
			tags: entry.tags,
			author: entry.author,
			license: entry.license,
			version: entry.version,
			localVersion,
			sha256: entry.sha256 || undefined,
			installed,
			enabled: installed ? Boolean(local?.enabled) : false,
			readonly: false,
			needsUpdate: installed && Boolean(localVersion) && localVersion !== entry.version,
			setupRequired: false,
			busy: busyIds.has(id),
			downloadCount: entry.download_count,
			isCustom: false,
			isBuiltin: false,
			fromMarket: true,
			origin: getOpenCatalogOrigin(entry),
			market: entry,
			searchTerms: terms(entry.slug, entry.name, entry.description, entry.tags),
		});
	}

	// 本地已装但市场已下架 / 自定义导入的 skill。
	for (const [name, local] of Object.entries(skillManifest)) {
		const type = manifestType(local);
		const ledgerEntry = ledger[physicalLedgerKey(type, name)];
		const claimed = items.some((item) => item.slug === name && item.type === type && item.installed);
		if (claimed) continue;
		const id = ledgerEntry?.catalogId ?? abilityId(type, name);
		seen.add(id);
		claimedNames.add(`${type}:${name}`);
		const isCustom = local.source === "custom";
		items.push({
			type,
			id,
			slug: name,
			catalogSource: catalogSourceFromLedger(ledgerEntry),
			title: local.alias || name,
			description: local.source === "custom" ? local.description : (local.marketDescription ?? ""),
			category: "",
			tags: [],
			author: "",
			license: "",
			version: local.version,
			localVersion: ledgerEntry?.version ?? local.version,
			installed: true,
			enabled: local.enabled,
			readonly: false,
			needsUpdate: false,
			setupRequired: false,
			busy: busyIds.has(id),
			downloadCount: 0,
			isCustom,
			isBuiltin: false,
			fromMarket: false,
			origin: ledgerEntry?.origin?.kind === "github-marketplace" ? ledgerEntry.origin : undefined,
			searchTerms: terms(name, local.alias),
		});
	}

	// 运行时列出、但不进台账的只读 skill：随 App 分发的内置（source=builtin）走 builtin 来源，
	// `~/.agents/skills` 里用户自己放的、插件贡献的都是本地来源，不能算 Vetta 内置。
	for (const skill of localSkills) {
		if (claimedNames.has(`${skill.type}:${skill.name}`)) continue;
		const isBuiltin = skill.source === "builtin";
		const source = isBuiltin ? BUILTIN_SOURCE : LOCAL_SOURCE;
		const id = abilityId(skill.type, skill.name, source);
		if (seen.has(id)) continue;
		seen.add(id);
		items.push({
			type: skill.type,
			id,
			slug: skill.name,
			catalogSource: source,
			title: skill.alias || skill.name,
			description: skill.description,
			// 内置走 renderer 静态资源；插件贡献 skill 带宿主插件 iconUrl；其余落默认图。
			icon: isBuiltin ? builtinSkillIconUrl(skill.name) : skill.icon,
			category: "",
			tags: [],
			author: "",
			license: "",
			version: "",
			installed: true,
			enabled: true,
			readonly: true,
			needsUpdate: false,
			setupRequired: false,
			busy: false,
			downloadCount: 0,
			isCustom: false,
			isBuiltin,
			fromMarket: false,
			skillSource: skill.source,
			searchTerms: terms(skill.name, skill.alias, skill.description),
		});
	}

	return items;
}

// ─── mcp ───

interface McpBuildInput {
	slug: string;
	serverName: string;
	catalogSource: AbilityCatalogSource;
	id: string;
	preset?: BuiltinMcpPreset;
	entry?: MarketAbility;
	ledgerEntry?: AbilityLedgerEntry;
}

interface OpenMarketMcpParameter {
	key: string;
	label: string;
	required: boolean;
	secret: boolean;
	placeholder?: string;
	helpUrl?: string;
	valueTemplate?: string;
}

interface OpenMarketMcpConfig {
	mcp?: Record<string, unknown>;
	mcp_browser_auth?: boolean;
	mcp_parameters?: OpenMarketMcpParameter[];
}

function createMarketMcpPreset(entry: MarketAbility, serverName: string): BuiltinMcpPreset | undefined {
	const config = entry.config as OpenMarketMcpConfig;
	if (!config.mcp) return undefined;
	return {
		id: buildMarketAbilityId(entry),
		name: serverName,
		iconUrl: entry.icon,
		displayName: entry.name,
		description: entry.description,
		config: config.mcp as unknown as McpServerConfigData,
		secrets: config.mcp_parameters?.map((parameter) => ({
			envKey: parameter.key,
			label: parameter.label,
			required: parameter.required,
			secret: parameter.secret,
			placeholder: parameter.placeholder,
			helpUrl: parameter.helpUrl,
			valueTemplate: parameter.valueTemplate,
		})),
		browserAuth: config.mcp_browser_auth ?? false,
	};
}

function createMcpAbility(input: McpBuildInput, state: LocalAbilityState, t: TFunction<"settings">): McpAbility {
	const { slug, entry, serverName, catalogSource, id, ledgerEntry } = input;
	const servers = state.mcpConfig?.mcpServers ?? {};
	const server = servers[serverName];
	const preset =
		input.preset ??
		(entry ? createMarketMcpPreset(entry, serverName) : undefined) ??
		(server ? matchBuiltinMcpPreset(serverName, server) : undefined);
	const title = preset
		? resolveMcpPresetDisplayName(preset, (key) => t(key))
		: server?.displayName || entry?.name || slug;
	const description = preset
		? resolveMcpPresetDescription(preset, (key) => t(key))
		: server?.description?.trim() || entry?.description || "";
	const usesOAuth = server ? serverUsesOAuth(serverName, server) : Boolean(preset && presetUsesOAuth(preset));
	const authorized = usesOAuth && Boolean(state.oauthAuthByName[serverName]);
	const needsSecrets = Boolean(server && preset && missingRequiredSecrets(preset, server).length > 0);
	const installed = Boolean(server);
	const localVersion = ledgerEntry?.version;
	const icon = server
		? (resolveMcpIcon(serverName, server) ?? entry?.icon)
		: preset
			? resolveMcpPresetIconUrl(preset)
			: entry?.icon;

	return {
		type: "mcp",
		id,
		slug,
		catalogSource,
		serverName,
		title,
		description,
		icon: icon || undefined,
		category: entry?.category ?? "",
		categoryI18n: entry?.category_i18n,
		tags: entry?.tags ?? [],
		author: entry?.author ?? "",
		license: entry?.license ?? "",
		version: entry?.version ?? localVersion ?? "",
		localVersion,
		installed,
		enabled: installed && !(server?.disabled ?? false),
		readonly: false,
		needsUpdate: installed && Boolean(entry && localVersion) && localVersion !== entry?.version,
		setupRequired: installed && (needsSecrets || (usesOAuth && !authorized)),
		busy: state.busyIds.has(id),
		downloadCount: entry?.download_count ?? 0,
		isCustom: installed && !preset && !entry,
		isBuiltin: false,
		fromMarket: Boolean(entry),
		origin:
			(entry ? getOpenCatalogOrigin(entry) : undefined) ??
			(ledgerEntry?.origin?.kind === "github-marketplace" ? ledgerEntry.origin : undefined),
		market: entry,
		detail: entry ? undefined : preset?.detail,
		preset,
		usesOAuth,
		authorized,
		canConfigure: installed && Boolean(preset?.secrets?.length),
		canEdit: Boolean(server && !isBuiltinMcpServer(serverName, server)),
		searchTerms: terms(slug, title, description, entry?.tags),
	};
}

function hashCatalogId(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function qualifiedMcpServerName(slug: string, catalogId: string): string {
	const safeSlug = slug.replace(/[^a-zA-Z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp";
	return `${safeSlug.slice(0, 48)}--${hashCatalogId(catalogId)}`;
}

function availableMcpServerName(preferred: string, servers: Record<string, McpServerConfigData>): string {
	if (!servers[preferred]) return preferred;
	let suffix = 2;
	while (servers[`${preferred}-${suffix}`]) suffix += 1;
	return `${preferred}-${suffix}`;
}

function findMcpLedgerEntry(
	ledger: AbilityLedger,
	catalogId: string,
	source: AbilityCatalogSource,
	slug: string,
): { entry: AbilityLedgerEntry; runtimeName: string } | undefined {
	for (const [key, entry] of Object.entries(ledger)) {
		if (!key.startsWith("mcp:") || entry.catalogId !== catalogId) continue;
		return { entry, runtimeName: entry.runtimeName ?? key.slice("mcp:".length) };
	}
	const legacy = ledger[physicalLedgerKey("mcp", slug)];
	if (!ledgerEntryMatchesCatalog(legacy, catalogId, source)) return undefined;
	return { entry: legacy, runtimeName: legacy.runtimeName ?? slug };
}

export function buildMcpAbilities(
	market: MarketAbility[],
	state: LocalAbilityState,
	t: TFunction<"settings">,
): McpAbility[] {
	const marketEntries = market.filter((entry) => entry.type === "mcp");
	const listedPresets = getListedBuiltinMcpPresets();
	const presetNames = new Set(listedPresets.map((preset) => preset.name));
	const slugCounts = new Map<string, number>();
	for (const entry of marketEntries) slugCounts.set(entry.slug, (slugCounts.get(entry.slug) ?? 0) + 1);
	const items: McpAbility[] = [];
	const claimedServerNames = new Set<string>();
	const marketItems: McpAbility[] = [];

	for (const entry of marketEntries) {
		const catalogSource = getMarketCatalogSource(entry);
		const id = buildMarketAbilityId(entry);
		const ledgerMatch = findMcpLedgerEntry(state.ledger, id, catalogSource, entry.slug);
		const hasCatalogConflict = (slugCounts.get(entry.slug) ?? 0) > 1 || presetNames.has(entry.slug);
		const preferredName = hasCatalogConflict ? qualifiedMcpServerName(entry.slug, id) : entry.slug;
		const serverName =
			ledgerMatch?.runtimeName ?? availableMcpServerName(preferredName, state.mcpConfig?.mcpServers ?? {});
		const item = createMcpAbility(
			{
				slug: entry.slug,
				serverName,
				catalogSource,
				id,
				entry,
				ledgerEntry: ledgerMatch?.entry,
			},
			state,
			t,
		);
		if (item.installed) claimedServerNames.add(serverName);
		marketItems.push(item);
	}

	for (const preset of listedPresets) {
		const serverName = preset.name;
		const ledgerEntry = state.ledger[physicalLedgerKey("mcp", serverName)];
		const claimedByMarket = claimedServerNames.has(serverName);
		const item = createMcpAbility(
			{
				slug: preset.name,
				serverName,
				catalogSource: BUILTIN_SOURCE,
				id: abilityId("mcp", preset.name, BUILTIN_SOURCE),
				preset,
				ledgerEntry: claimedByMarket ? undefined : ledgerEntry,
			},
			{
				...state,
				mcpConfig: claimedByMarket
					? {
							mcpServers: Object.fromEntries(
								Object.entries(state.mcpConfig?.mcpServers ?? {}).filter(([name]) => name !== serverName),
							),
						}
					: state.mcpConfig,
			},
			t,
		);
		if (item.installed) claimedServerNames.add(serverName);
		// 内置预设没有服务端分类，统一归到「连接」分组
		items.push({ ...item, category: ABILITY_CATEGORY_CONNECTORS });
	}
	items.push(...marketItems);
	for (const serverName of Object.keys(state.mcpConfig?.mcpServers ?? {})) {
		if (claimedServerNames.has(serverName)) continue;
		const ledgerEntry = state.ledger[physicalLedgerKey("mcp", serverName)];
		items.push(
			createMcpAbility(
				{
					slug: ledgerEntry?.slug ?? serverName,
					serverName,
					catalogSource: LOCAL_SOURCE,
					id: ledgerEntry?.catalogId ?? abilityId("mcp", serverName),
					ledgerEntry,
				},
				state,
				t,
			),
		);
	}
	return items;
}

// ─── plugin ───

function toPluginPermissions(values: string[] | undefined): PluginPermission[] {
	return (values ?? []) as PluginPermission[];
}

/** manifest 的 agent_mode（string | string[]）→ 归一化数组；空 = 通用。见 ADR-0046。 */
function toAgentModes(raw: string | string[] | undefined): string[] {
	if (raw === undefined) return [];
	return (Array.isArray(raw) ? raw : [raw]).map((mode) => mode.trim()).filter((mode) => mode.length > 0);
}

export function buildPluginAbilities(
	market: MarketAbility[],
	state: LocalAbilityState,
	trPlugin: PluginTextResolver,
): PluginAbility[] {
	const { ledger, plugins, busyIds } = state;
	const installedById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
	const items: PluginAbility[] = [];

	const create = (slug: string, entry: MarketAbility | undefined, plugin: InstalledPlugin | null): PluginAbility => {
		const catalogSource = entry ? getMarketCatalogSource(entry) : LOCAL_SOURCE;
		const id = entry ? buildMarketAbilityId(entry) : abilityId("plugin", slug);
		const ledgerEntry = ledger[physicalLedgerKey("plugin", slug)];
		const installed =
			plugin !== null &&
			(!entry ||
				ledgerEntryMatchesCatalog(ledgerEntry, id, catalogSource) ||
				(!ledgerEntry && catalogSource.kind === "server"));
		const installedPlugin = installed ? plugin : null;
		const isSystem = installedPlugin?.source === "system";
		const localVersion = installed ? (ledgerEntry?.version ?? plugin?.activeVersion) : undefined;
		// manifest 的 name/description 可能是 `%key%` NLS 占位符（ADR-0033），必须过 catalog 解析。
		// 已装插件一律用它自带的 catalog：注册表只有已启用且加载成功的插件，刚装完（默认未启用）
		// 查不到就会把裸 key 显示成名字。
		const title = trPlugin(slug, installedPlugin?.name ?? entry?.name, installedPlugin ?? undefined) || slug;
		const description = trPlugin(
			slug,
			installedPlugin?.description ?? entry?.description,
			installedPlugin ?? undefined,
		);
		return {
			type: "plugin",
			id,
			slug,
			catalogSource,
			title,
			description,
			icon: installedPlugin?.iconUrl ?? entry?.icon ?? undefined,
			category: entry?.category ?? "",
			categoryI18n: entry?.category_i18n,
			tags: entry?.tags ?? [],
			author: installedPlugin?.author ?? entry?.author ?? "",
			license: entry?.license ?? "",
			version: entry?.version ?? installedPlugin?.activeVersion ?? "",
			localVersion,
			sha256: entry?.sha256 || undefined,
			installed,
			enabled: installedPlugin?.enabled ?? false,
			readonly: isSystem || Boolean(installedPlugin?.required),
			needsUpdate:
				Boolean(installedPlugin) && !isSystem && Boolean(entry && localVersion) && localVersion !== entry?.version,
			setupRequired: false,
			busy: busyIds.has(id),
			downloadCount: entry?.download_count ?? 0,
			isCustom: installedPlugin?.source === "archive" || installedPlugin?.source === "npm",
			isBuiltin: isSystem,
			fromMarket: Boolean(entry),
			origin:
				(entry ? getOpenCatalogOrigin(entry) : undefined) ??
				(ledgerEntry?.origin?.kind === "github-marketplace" ? ledgerEntry.origin : undefined),
			market: entry,
			plugin: installedPlugin,
			agentModes: toAgentModes(installedPlugin?.agent_mode),
			permissions: installedPlugin ? installedPlugin.permissions : toPluginPermissions(entry?.config.permissions),
			grantedPermissions: installedPlugin?.grantedPermissions ?? [],
			commands: installedPlugin ? installedPlugin.declaredCommands : (entry?.config.commands ?? []),
			grantedCommands: installedPlugin?.grantedCommandNames ?? [],
			pendingVersion: installedPlugin?.pendingVersion,
			searchTerms: terms(slug, title, description, entry?.tags),
		};
	};

	for (const entry of market) {
		if (entry.type !== "plugin") continue;
		items.push(create(entry.slug, entry, installedById.get(entry.slug) ?? null));
	}
	for (const plugin of plugins) {
		if (items.some((item) => item.slug === plugin.id && item.installed)) continue;
		const ledgerEntry = ledger[physicalLedgerKey("plugin", plugin.id)];
		const item = create(plugin.id, undefined, plugin);
		items.push({
			...item,
			id: ledgerEntry?.catalogId ?? item.id,
			catalogSource: plugin.source === "system" ? BUILTIN_SOURCE : catalogSourceFromLedger(ledgerEntry),
		});
	}
	return items;
}

// ─── bundle ───

/**
 * bundle 私有内联 mcp 成员：按定义没有市场行，安装前本地 mcp.json 也没有这个 key，
 * 因此在此就地合成条目，配置取 `member.inline`（安装时原样写入 mcpServers[slug]）。
 */
function createInlineMcpAbility(member: AbilityMember, state: LocalAbilityState, t: TFunction<"settings">): McpAbility {
	const base = createMcpAbility(
		{
			slug: member.slug,
			serverName: member.slug,
			catalogSource: LOCAL_SOURCE,
			id: abilityId("mcp", member.slug),
		},
		state,
		t,
	);
	return {
		...base,
		title: base.installed ? base.title : member.name || member.slug,
		icon: base.icon ?? (member.icon || undefined),
		version: member.version || base.version,
		inlineConfig: member.inline,
	};
}

/** bundle 恒无产物，状态全部由成员派生；不进台账故无独立版本比对。 */
export function buildBundleAbilities(
	market: MarketAbility[],
	members: AbilityItem[],
	state: LocalAbilityState,
	t: TFunction<"settings">,
): BundleAbility[] {
	const byId = new Map(members.map((item) => [item.id, item]));
	const items: BundleAbility[] = [];

	for (const entry of market) {
		if (entry.type !== "bundle") continue;
		const catalogSource = getMarketCatalogSource(entry);
		const declared = entry.config.members ?? [];
		const resolved = declared.map((member) => {
			const found = byId.get(`${catalogSource.kind}:${catalogSource.id}:${member.type}:${member.slug}`);
			if (found) return found;
			return member.type === "mcp" && member.inline ? createInlineMcpAbility(member, state, t) : undefined;
		});
		const memberItems = resolved.filter((item): item is AbilityItem => item !== undefined);
		const installable = memberItems.filter((item) => !item.readonly);
		// 解析不到的成员（已下架 / 未上架）视为未满足，否则 bundle 会假装已装完
		const installed = declared.length > 0 && resolved.every((item) => Boolean(item?.readonly || item?.installed));
		items.push({
			type: "bundle",
			id: buildMarketAbilityId(entry),
			slug: entry.slug,
			catalogSource,
			title: entry.name || entry.slug,
			description: entry.description,
			icon: entry.icon || undefined,
			category: entry.category,
			categoryI18n: entry.category_i18n,
			tags: entry.tags,
			author: entry.author,
			license: entry.license,
			version: entry.version,
			installed,
			enabled: installed && installable.every((item) => item.enabled),
			readonly: false,
			needsUpdate: installable.some((item) => item.needsUpdate),
			setupRequired: installable.some((item) => item.installed && item.setupRequired),
			busy: state.busyIds.has(buildMarketAbilityId(entry)) || installable.some((item) => item.busy),
			downloadCount: entry.download_count,
			isCustom: false,
			isBuiltin: false,
			fromMarket: true,
			market: entry,
			members: declared,
			memberItems,
			searchTerms: terms(entry.slug, entry.name, entry.description, entry.tags),
		});
	}
	return items;
}
