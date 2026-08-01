import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type {
	AgentPluginContinuationContribution,
	AgentPluginMcpServerConfig,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptProviderContribution,
	AgentPluginToolContribution,
	McpServerContribution,
	SystemPromptBlock,
	SystemPromptOperation,
} from "@vetta/runtime-core";
import AdmZip from "adm-zip";
import { app, webContents } from "electron";
import type {
	InstalledPlugin,
	PluginAgentManifest,
	PluginDevWatchState,
	PluginInstallOptions,
	PluginLocaleCatalog,
	PluginLocales,
	PluginManifest,
	PluginMcpServerConfig,
	PluginPermission,
	PluginSettingSchema,
} from "../../preload/api-types/plugins.js";
import { recordAbilityInstall, removeAbilityLedgerEntry } from "../abilities/ability-ledger.js";
import { getAppLogger } from "../logger.js";
import { verifySha256 } from "../utils/integrity.js";

export const PLUGIN_API_VERSION = "1.2.0";
export const CORE_ACTION_PLUGIN_ID = "vetta-actions";
const REQUIRED_SYSTEM_PLUGIN_IDS = new Set<string>([CORE_ACTION_PLUGIN_ID]);
const pluginsBaseDir = join(getVettaHomePath(), "plugins");
const manifestPath = join(getVettaHomePath(), "plugins-manifest.json");
const tmpBaseDir = join(getVettaHomePath(), "tmp", "plugins");
// 系统插件的用户态偏好（目前仅停用开关），与用户插件注册表分离（ADR-0024）。
const systemPrefsPath = join(getVettaHomePath(), "system-plugin-prefs.json");

type PluginManifestFile = Record<string, InstalledPlugin>;
type SystemPluginPrefs = Record<string, { enabled: boolean; disabledCommands?: string[] }>;
type RegisteredAgentTool = Omit<AgentPluginToolContribution, "pluginId"> & { activationId?: string };
type RegisteredContinuationProvider = Omit<AgentPluginContinuationContribution, "pluginId"> & {
	activationId?: string;
};
type RegisteredSystemPromptProvider = Omit<AgentPluginSystemPromptProviderContribution, "pluginId"> & {
	activationId?: string;
};

const pluginLog = getAppLogger("plugin");
const dynamicAgentTools = new Map<string, Map<string, RegisteredAgentTool>>();
const dynamicContinuationProviders = new Map<string, Map<string, RegisteredContinuationProvider>>();
const dynamicSystemPromptProviders = new Map<string, Map<string, RegisteredSystemPromptProvider>>();
/** Plugins that hard-isolate agent contributions until contribution mode is on (ADR-0041). */
const modeGatedPluginIds = new Set<string>();
/** Subset of mode-gated plugins currently active (toggle on). */
const activeContributionModeIds = new Set<string>();

/**
 * Tell every renderer to re-list and re-load plugins (MF remotes + activity tabs).
 * Without this, install/enable via Action or workbench leaves the UI on the pre-install set.
 */
export function broadcastPluginsChanged(): void {
	for (const contents of webContents.getAllWebContents()) {
		if (contents.isDestroyed()) continue;
		try {
			contents.send("vetta:plugins:changed");
		} catch {
			// ignore gone frames
		}
	}
}
const dynamicAgentActivations = new Map<string, string>();

function debugPluginAgent(message: string, data?: Record<string, unknown>): void {
	pluginLog.debug(message, data ?? {});
}

function summarizeRuntimeConfig(config: AgentPluginRuntimeConfig | undefined): Record<string, unknown> {
	return {
		systemPromptPlugins: config?.systemPromptContributions?.map((item) => item.pluginId) ?? [],
		skillPlugins: config?.skillPathContributions?.map((item) => item.pluginId) ?? [],
		toolPolicyPlugins: config?.toolPolicyContributions?.map((item) => item.pluginId) ?? [],
		toolContributions: config?.toolContributions?.map((tool) => `${tool.pluginId}:${tool.name}`) ?? [],
		continuationContributions:
			config?.continuationContributions?.map((provider) => `${provider.pluginId}:${provider.id}`) ?? [],
		systemPromptProviders:
			config?.systemPromptProviderContributions?.map((provider) => `${provider.pluginId}:${provider.id}`) ?? [],
		mcpServers: config?.mcpServerContributions?.map((item) => item.runtimeName) ?? [],
	};
}

/** Kebab-case segment for plugin MCP runtime names (no underscores — tool adapter constraint). */
function normalizePluginMcpNameSegment(raw: string): string {
	const normalized = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!normalized) {
		throw new Error(`Invalid plugin MCP name segment: ${JSON.stringify(raw)}`);
	}
	return normalized;
}

/** Runtime name: `plugin-<pluginId>-<localName>` (unique, no `_`). */
export function buildPluginMcpRuntimeName(pluginId: string, localName: string): string {
	return `plugin-${normalizePluginMcpNameSegment(pluginId)}-${normalizePluginMcpNameSegment(localName)}`;
}

function isAbsoluteFsPath(value: string): boolean {
	return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

/** Relative path or `.` → resolve under plugin root; bare binary name left as-is. */
function resolvePluginPathArg(pluginRoot: string, value: string): string {
	if (isAbsoluteFsPath(value)) return value;
	if (
		value === "." ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.includes("/") ||
		value.includes("\\")
	) {
		return resolve(pluginRoot, value);
	}
	return value;
}

/**
 * Resolve stdio paths against the plugin install root so the MCP process can
 * start from any session cwd.
 */
function resolvePluginMcpServerConfig(pluginRoot: string, config: PluginMcpServerConfig): AgentPluginMcpServerConfig {
	if (config.type === "http") {
		return { ...config };
	}
	const cwd = resolvePluginPathArg(pluginRoot, config.cwd === undefined ? "." : config.cwd);
	return {
		...config,
		type: config.type,
		command: resolvePluginPathArg(pluginRoot, config.command),
		args: config.args?.map((arg) => resolvePluginPathArg(pluginRoot, arg)),
		cwd,
	};
}

function parsePluginMcpServerConfig(name: string, raw: unknown): PluginMcpServerConfig {
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`Invalid plugin MCP server config for '${name}'`);
	}
	const input = raw as Record<string, unknown>;
	const type = input.type === undefined || input.type === "stdio" || input.type === "http" ? input.type : undefined;
	if (input.type !== undefined && type === undefined) {
		throw new Error(`Invalid plugin MCP server type for '${name}'`);
	}
	if (type === "http") {
		const url = assertString(input.url, `mcpServers.${name}.url`);
		const headers =
			input.headers === undefined
				? undefined
				: (() => {
						if (input.headers == null || typeof input.headers !== "object" || Array.isArray(input.headers)) {
							throw new Error(`Invalid plugin MCP headers for '${name}'`);
						}
						const result: Record<string, string> = {};
						for (const [key, value] of Object.entries(input.headers as Record<string, unknown>)) {
							if (typeof value !== "string") {
								throw new Error(`Invalid plugin MCP header value for '${name}.${key}'`);
							}
							result[key] = value;
						}
						return result;
					})();
		return {
			type: "http",
			url,
			headers,
			oauthClientId: typeof input.oauthClientId === "string" ? input.oauthClientId : undefined,
			oauthDeviceFlow: typeof input.oauthDeviceFlow === "boolean" ? input.oauthDeviceFlow : undefined,
			oauthScopes: typeof input.oauthScopes === "string" ? input.oauthScopes : undefined,
			disabled: typeof input.disabled === "boolean" ? input.disabled : undefined,
			autoApprove:
				input.autoApprove === undefined
					? undefined
					: assertStringArray(input.autoApprove, `mcpServers.${name}.autoApprove`),
			startupTimeout: typeof input.startupTimeout === "number" ? input.startupTimeout : undefined,
			debug: typeof input.debug === "boolean" ? input.debug : undefined,
			displayName: typeof input.displayName === "string" ? input.displayName : undefined,
			description: typeof input.description === "string" ? input.description : undefined,
		};
	}
	const command = assertString(input.command, `mcpServers.${name}.command`);
	const args =
		input.args === undefined
			? undefined
			: (() => {
					if (!Array.isArray(input.args) || input.args.some((item) => typeof item !== "string")) {
						throw new Error(`Invalid plugin MCP args for '${name}'`);
					}
					return input.args as string[];
				})();
	const env =
		input.env === undefined
			? undefined
			: (() => {
					if (input.env == null || typeof input.env !== "object" || Array.isArray(input.env)) {
						throw new Error(`Invalid plugin MCP env for '${name}'`);
					}
					const result: Record<string, string> = {};
					for (const [key, value] of Object.entries(input.env as Record<string, unknown>)) {
						if (typeof value !== "string") {
							throw new Error(`Invalid plugin MCP env value for '${name}.${key}'`);
						}
						result[key] = value;
					}
					return result;
				})();
	return {
		type: type === "stdio" ? "stdio" : undefined,
		command,
		args,
		env,
		cwd: typeof input.cwd === "string" ? input.cwd : undefined,
		disabled: typeof input.disabled === "boolean" ? input.disabled : undefined,
		autoApprove:
			input.autoApprove === undefined
				? undefined
				: assertStringArray(input.autoApprove, `mcpServers.${name}.autoApprove`),
		startupTimeout: typeof input.startupTimeout === "number" ? input.startupTimeout : undefined,
		debug: typeof input.debug === "boolean" ? input.debug : undefined,
		displayName: typeof input.displayName === "string" ? input.displayName : undefined,
		description: typeof input.description === "string" ? input.description : undefined,
	};
}

function parseMcpServersField(raw: unknown): PluginAgentManifest["mcpServers"] {
	if (raw === undefined) return undefined;
	if (typeof raw === "string") {
		return validateRelativePath(raw.trim(), "agent.mcpServers");
	}
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Invalid plugin agent.mcpServers");
	}
	const result: Record<string, PluginMcpServerConfig> = {};
	for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!name.trim()) throw new Error("Invalid plugin MCP server name");
		result[name.trim()] = parsePluginMcpServerConfig(name, value);
	}
	return result;
}

/**
 * Materialize plugin MCP contributions for an installed plugin.
 * Skips on missing files / parse errors (warn) so one bad plugin does not block others.
 */
function buildMcpServerContributionsForPlugin(plugin: InstalledPlugin): McpServerContribution[] {
	const declared = plugin.agent?.mcpServers;
	if (!declared) return [];
	if (!hasGrantedPermission(plugin, "agent.mcp.control")) {
		debugPluginAgent("skip mcp contributions: missing agent.mcp.control", { pluginId: plugin.id });
		return [];
	}

	let servers: Record<string, PluginMcpServerConfig>;
	// User plugins live under versions/<ver>/; system and dev-linked plugins at package root.
	const pluginRoot =
		plugin.source === "system" || devLinks.has(plugin.id)
			? resolvePluginFilePath(plugin.id, ".")
			: resolvePluginFilePath(plugin.id, `versions/${encodeURIComponent(plugin.activeVersion)}`);

	try {
		if (typeof declared === "string") {
			const configPath = resolveInstalledPluginResource(plugin, declared);
			if (!existsSync(configPath)) {
				pluginLog.warn(`Plugin ${plugin.id}: MCP config missing at ${declared}`);
				return [];
			}
			const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
			if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
				pluginLog.warn(`Plugin ${plugin.id}: MCP config is not an object`);
				return [];
			}
			const map = (parsed as Record<string, unknown>).mcpServers;
			if (map == null || typeof map !== "object" || Array.isArray(map)) {
				pluginLog.warn(`Plugin ${plugin.id}: MCP config missing mcpServers object`);
				return [];
			}
			servers = {};
			for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
				servers[name] = parsePluginMcpServerConfig(name, value);
			}
		} else {
			servers = declared;
		}
	} catch (error) {
		pluginLog.warn(`Plugin ${plugin.id}: failed to load MCP servers:`, error);
		return [];
	}

	const contributions: McpServerContribution[] = [];
	for (const [localName, config] of Object.entries(servers)) {
		try {
			const runtimeName = buildPluginMcpRuntimeName(plugin.id, localName);
			const resolved = resolvePluginMcpServerConfig(pluginRoot, config);
			contributions.push({
				pluginId: plugin.id,
				localName,
				runtimeName,
				config: resolved,
				// agent_mode 轴：per-server 工作模式（缺省/空 = 通用）。见 ADR-0046。
				agent_mode: normalizeAgentModeList(config.agent_mode),
			});
		} catch (error) {
			pluginLog.warn(`Plugin ${plugin.id}: skip MCP server '${localName}':`, error);
		}
	}
	return contributions;
}

export function summarizeAgentPluginRuntimeConfig(
	config: AgentPluginRuntimeConfig | undefined,
): Record<string, unknown> {
	return summarizeRuntimeConfig(config);
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readRegistry(): PluginManifestFile {
	if (!existsSync(manifestPath)) return {};
	try {
		const registry = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifestFile;
		for (const plugin of Object.values(registry)) {
			plugin.runtime ??= "esm";
			plugin.permissions ??= [];
			plugin.grantedPermissions ??= [];
			plugin.declaredCommands ??= [];
			plugin.grantedCommandNames ??= [];
			plugin.styleUrls ??= [];
			plugin.activeVersion ??= plugin.version;
			plugin.defaultLocale ??= "zh";
			plugin.locales ??= {};
			plugin.source ??= "archive";
			plugin.required = false;
			// 用户可编辑的注册表不是信任根；远端签名链接入前一律按来源降为非官方。
			plugin.trustLevel = plugin.source === "remote" ? "community" : "local";
			plugin.rootPath = computePluginRootPath(plugin.id, plugin.source, plugin.activeVersion);
		}
		return registry;
	} catch {
		return {};
	}
}

function writeRegistry(registry: PluginManifestFile): void {
	ensureDir(dirname(manifestPath));
	writeFileSync(manifestPath, JSON.stringify(registry, null, 2), "utf-8");
}

function assertString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid plugin ${fieldName}`);
	}
	return value.trim();
}

function assertStringArray(value: unknown, fieldName: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
		throw new Error(`Invalid plugin ${fieldName}`);
	}
	return value.map((item) => item.trim());
}

function assertPermissionArray(value: unknown): PluginPermission[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
		throw new Error("Invalid plugin permissions");
	}
	return Array.from(new Set(value.map((item) => item.trim() as PluginPermission)));
}

const SETTING_TYPES = new Set(["string", "number", "boolean", "enum", "secret", "desc"]);

function parseVisibleWhen(raw: unknown, key: string): PluginSettingSchema["visibleWhen"] {
	if (raw === undefined) return undefined;
	if (raw == null || typeof raw !== "object") {
		throw new Error(`Invalid plugin setting visibleWhen for ${key}`);
	}
	const condition = raw as Record<string, unknown>;
	return {
		key: assertString(condition.key, "setting.visibleWhen.key"),
		in: assertStringArray(condition.in, "setting.visibleWhen.in"),
	};
}

function parseSettingsSchema(raw: unknown): PluginSettingSchema[] | undefined {
	if (raw == null || typeof raw !== "object") return undefined;
	const settings = (raw as Record<string, unknown>).settings;
	if (settings === undefined) return undefined;
	if (!Array.isArray(settings)) {
		throw new Error("Invalid plugin contributes.settings");
	}
	const parsed = settings.map((item): PluginSettingSchema => {
		if (item == null || typeof item !== "object") {
			throw new Error("Invalid plugin setting entry");
		}
		const setting = item as Record<string, unknown>;
		const key = assertString(setting.key, "setting.key");
		if (typeof setting.type !== "string" || !SETTING_TYPES.has(setting.type)) {
			throw new Error(`Invalid plugin setting type for ${key}`);
		}
		const def = setting.default;
		if (def !== undefined && typeof def !== "string" && typeof def !== "number" && typeof def !== "boolean") {
			throw new Error(`Invalid plugin setting default for ${key}`);
		}
		// `desc` is text-only: title is optional (the note lives in description).
		const title =
			setting.type === "desc"
				? typeof setting.title === "string"
					? setting.title
					: undefined
				: assertString(setting.title, "setting.title");
		return {
			key,
			type: setting.type as PluginSettingSchema["type"],
			title,
			description: typeof setting.description === "string" ? setting.description : undefined,
			default: def,
			enum: setting.enum === undefined ? undefined : assertStringArray(setting.enum, "setting.enum"),
			visibleWhen: parseVisibleWhen(setting.visibleWhen, key),
		};
	});
	return parsed.length > 0 ? parsed : undefined;
}

function validatePluginId(id: string): void {
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
		throw new Error("Plugin id must be 1-64 chars: lowercase letters, numbers, dot, underscore, or dash");
	}
}

/** Command declarations are bare executable names — no path separators, no shell metacharacters. */
function parseCommands(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error("Invalid plugin commands");
	}
	const names = value.map((item) => {
		if (typeof item !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/.test(item)) {
			throw new Error("Invalid plugin command name (must be a bare executable name)");
		}
		return item;
	});
	return Array.from(new Set(names));
}

function validatePluginVersion(version: string): void {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/.test(version)) {
		throw new Error("Plugin version must be 1-64 chars and cannot contain path separators");
	}
}

function validateRelativePath(value: string, fieldName: string): string {
	const normalized = normalize(value).replace(/\\/g, "/");
	if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/") || /^[a-zA-Z]:/.test(value)) {
		throw new Error(`Invalid plugin ${fieldName}`);
	}
	return normalized;
}

/** Iconify 图标名：`solar:magic-stick-3-bold` 这种 `<集合>:<图标>` 形态。 */
const ICONIFY_ICON_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 图标三态判定：Iconify 名与 `http(s)://` 外链原样透传给渲染层；
 * 其余一律当包内相对路径交给 validateRelativePath（含盘符的绝对路径会被它拒绝）。
 */
function isPassthroughIconRef(icon: string): boolean {
	return icon.startsWith("http://") || icon.startsWith("https://") || ICONIFY_ICON_PATTERN.test(icon);
}

function parseIconRef(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	const icon = assertString(value, "icon");
	return isPassthroughIconRef(icon) ? icon : validateRelativePath(icon, "icon");
}

/**
 * manifest.icon → InstalledPlugin.iconUrl。相对路径才经 URL 构造器（自带 ?v= cache key，
 * 规避 Chromium 对 vetta-plugin:// 资源的缓存），Iconify/外链原样返回。
 */
function resolveIconUrl(icon: string | undefined, toUrl: (relativePath: string) => string): string | undefined {
	if (!icon) return undefined;
	return isPassthroughIconRef(icon) ? icon : toUrl(icon);
}

function parseManifest(raw: unknown): PluginManifest {
	if (raw == null || typeof raw !== "object") {
		throw new Error("Missing plugin.json");
	}
	const input = raw as Record<string, unknown>;
	const id = assertString(input.id, "id");
	const version = assertString(input.version, "version");
	validatePluginId(id);
	validatePluginVersion(version);
	const entry = validateRelativePath(assertString(input.entry, "entry"), "entry");
	const runtime =
		input.runtime === undefined || input.runtime === "esm" || input.runtime === "module-federation"
			? input.runtime
			: undefined;
	if (input.runtime !== undefined && runtime === undefined) {
		throw new Error("Invalid plugin runtime");
	}
	const moduleFederation =
		runtime === "module-federation" ? parseModuleFederationManifest(input.moduleFederation) : undefined;
	const agent = parseAgentManifest(input.agent);
	const styles = assertStringArray(input.styles, "styles").map((style) => validateRelativePath(style, "styles"));
	const permissions = assertPermissionArray(input.permissions);
	const commands = parseCommands(input.commands);
	const settings = parseSettingsSchema(input.contributes);
	return {
		id,
		name: assertString(input.name, "name"),
		version,
		pluginApiVersion: assertString(input.pluginApiVersion, "pluginApiVersion"),
		entry,
		runtime: runtime ?? "esm",
		moduleFederation,
		agent,
		styles,
		permissions,
		commands: commands.length > 0 ? commands : undefined,
		contributes: settings ? { settings } : undefined,
		description: typeof input.description === "string" ? input.description : undefined,
		author: typeof input.author === "string" ? input.author : undefined,
		icon: parseIconRef(input.icon),
		guidingWords:
			input.guidingWords === undefined ? undefined : assertStringArray(input.guidingWords, "guidingWords"),
		defaultLocale: parseDefaultLocale(input.defaultLocale),
		contributionMode: parseContributionMode(input.contributionMode),
		// 插件级工作模式白名单（agent_mode 轴，缺省/空 = 通用/全局）。见 ADR-0046。
		agent_mode: normalizeAgentModeList(input.agent_mode),
	};
}

function parseContributionMode(raw: unknown): PluginManifest["contributionMode"] {
	if (raw === undefined) return undefined;
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Invalid plugin contributionMode");
	}
	const input = raw as Record<string, unknown>;
	return {
		hardIsolation: input.hardIsolation === true,
	};
}

/** Locale code: 2-16 chars, letters/digits/dash (e.g. "zh", "en", "zh-Hans"). Defaults to "zh". */
function parseDefaultLocale(value: unknown): string {
	if (value === undefined) return "zh";
	if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9-]{1,15}$/.test(value)) {
		throw new Error("Invalid plugin defaultLocale");
	}
	return value;
}

/**
 * Load a plugin's sidecar catalogs from `<dir>/locales/<lang>.json` (flat
 * key→string maps). All languages are read at once so the renderer can switch
 * locale locally without re-IPC (ADR-0033). Malformed files are skipped+warned,
 * never fatal.
 */
function loadPluginLocales(dir: string): PluginLocales {
	const localesDir = join(dir, "locales");
	if (!existsSync(localesDir)) return {};
	const result: PluginLocales = {};
	for (const file of readdirSync(localesDir)) {
		if (!file.endsWith(".json")) continue;
		const lang = file.slice(0, -".json".length);
		try {
			const parsed: unknown = JSON.parse(readFileSync(join(localesDir, file), "utf-8"));
			if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
			const catalog: PluginLocaleCatalog = {};
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value === "string") catalog[key] = value;
			}
			result[lang] = catalog;
		} catch (err) {
			pluginLog.warn(`locales: 跳过 ${file}（${dir}）：`, err);
		}
	}
	return result;
}

function parseModuleFederationManifest(raw: unknown): PluginManifest["moduleFederation"] {
	if (raw == null || typeof raw !== "object") {
		throw new Error("Missing plugin moduleFederation");
	}
	const input = raw as Record<string, unknown>;
	const remoteName = assertString(input.remoteName, "moduleFederation.remoteName");
	if (!/^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/.test(remoteName)) {
		throw new Error("Invalid plugin moduleFederation.remoteName");
	}
	const expose = assertString(input.expose, "moduleFederation.expose");
	if (!expose.startsWith("./") || expose.includes("..") || expose.includes("\\")) {
		throw new Error("Invalid plugin moduleFederation.expose");
	}
	return {
		remoteName,
		expose,
	};
}

function parseToolPolicy(raw: unknown): PluginAgentManifest["toolPolicy"] {
	if (raw === undefined) return undefined;
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Invalid plugin agent.toolPolicy");
	}
	const input = raw as Record<string, unknown>;
	return {
		allow: assertStringArray(input.allow, "agent.toolPolicy.allow"),
		deny: assertStringArray(input.deny, "agent.toolPolicy.deny"),
	};
}

function parseAgentManifest(raw: unknown): PluginAgentManifest | undefined {
	if (raw === undefined) return undefined;
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Invalid plugin agent");
	}
	const input = raw as Record<string, unknown>;
	const systemPrompt =
		input.systemPrompt === undefined
			? undefined
			: (() => {
					if (
						input.systemPrompt == null ||
						typeof input.systemPrompt !== "object" ||
						Array.isArray(input.systemPrompt)
					) {
						throw new Error("Invalid plugin agent.systemPrompt");
					}
					const promptInput = input.systemPrompt as Record<string, unknown>;
					return {
						promptPaths: assertStringArray(promptInput.promptPaths, "agent.systemPrompt.promptPaths").map(
							(path) => validateRelativePath(path, "agent.systemPrompt.promptPaths"),
						),
					};
				})();
	return {
		systemPrompt,
		skillPaths: assertStringArray(input.skillPaths, "agent.skillPaths").map((path) =>
			validateRelativePath(path, "agent.skillPaths"),
		),
		mcpServers: parseMcpServersField(input.mcpServers),
		toolPolicy: parseToolPolicy(input.toolPolicy),
	};
}

function parseApiVersion(value: string): readonly [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareApiVersions(left: readonly [number, number, number], right: readonly [number, number, number]): number {
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return left[index] - right[index];
	}
	return 0;
}

function supportsPluginApi(range: string): boolean {
	const host = parseApiVersion(PLUGIN_API_VERSION)!;
	const normalized = range.trim();
	const exact = parseApiVersion(normalized);
	if (exact) return exact[0] === host[0] && compareApiVersions(host, exact) >= 0;
	const caret = normalized.startsWith("^") ? parseApiVersion(normalized.slice(1)) : undefined;
	if (caret) return caret[0] === host[0] && compareApiVersions(host, caret) >= 0;
	if (normalized === `^${host[0]}` || normalized === `${host[0]}.x`) return true;
	const minimum = normalized.startsWith(">=") ? parseApiVersion(normalized.slice(2)) : undefined;
	return minimum !== undefined && compareApiVersions(host, minimum) >= 0;
}

function versionedPath(version: string, relativePath: string): string {
	validatePluginVersion(version);
	return `versions/${encodeURIComponent(version)}/${validateRelativePath(relativePath, "path")}`;
}

function toPluginUrl(pluginId: string, version: string, relativePath: string): string {
	const normalized = validateRelativePath(relativePath, "path");
	return `vetta-plugin://${pluginId}/${versionedPath(version, normalized)}?v=${encodeURIComponent(version)}`;
}

function installedFromManifest(
	manifest: PluginManifest,
	options: PluginInstallOptions | undefined,
	previous: InstalledPlugin | undefined,
	locales: PluginLocales,
): InstalledPlugin {
	if (!supportsPluginApi(manifest.pluginApiVersion)) {
		throw new Error(`Unsupported plugin API version: ${manifest.pluginApiVersion}`);
	}
	const now = new Date().toISOString();
	const activeVersion = previous?.activeVersion ?? manifest.version;
	const entryUrl = previous?.entryUrl ?? toPluginUrl(manifest.id, activeVersion, manifest.entry);
	const styleUrls =
		previous?.styleUrls ?? (manifest.styles ?? []).map((style) => toPluginUrl(manifest.id, activeVersion, style));
	const grantedPermissions = Array.from(
		new Set(
			(options?.grantedPermissions ?? previous?.grantedPermissions ?? []).filter((p) =>
				manifest.permissions?.includes(p),
			),
		),
	);
	// 与 entryUrl/styleUrls 同源：已安装过就沿用 activeVersion 的图标 URL，避免指向未生效的新版本。
	const iconUrl = previous
		? previous.iconUrl
		: resolveIconUrl(manifest.icon, (path) => toPluginUrl(manifest.id, activeVersion, path));
	const declaredCommands = manifest.commands ?? [];
	// Fresh install enables all declared commands by default; the user can toggle
	// any of them off later. A reinstall preserves the prior allow set.
	const grantedCommandNames = Array.from(
		new Set((previous?.grantedCommandNames ?? declaredCommands).filter((name) => declaredCommands.includes(name))),
	);
	return {
		id: manifest.id,
		name: manifest.name,
		version: manifest.version,
		activeVersion,
		pluginApiVersion: manifest.pluginApiVersion,
		runtime: previous?.runtime ?? manifest.runtime ?? "esm",
		entryUrl,
		moduleFederation: previous?.moduleFederation ?? manifest.moduleFederation,
		agent: previous?.agent ?? manifest.agent,
		// 插件级工作模式白名单（agent_mode 轴）：始终跟随最新 manifest。见 ADR-0046。
		agent_mode: manifest.agent_mode,
		styleUrls,
		permissions: manifest.permissions ?? [],
		grantedPermissions,
		declaredCommands,
		grantedCommandNames,
		settingsSchema: manifest.contributes?.settings,
		description: manifest.description,
		author: manifest.author,
		iconUrl,
		guidingWords: manifest.guidingWords,
		defaultLocale: manifest.defaultLocale ?? "zh",
		locales,
		enabled: options?.enable === true ? true : (previous?.enabled ?? false),
		required: false,
		installedAt: previous?.installedAt ?? now,
		updatedAt: now,
		source: options?.source ?? "archive",
		trustLevel: options?.source === "remote" ? "community" : "local",
		availableVersion: previous && previous.version !== manifest.version ? manifest.version : undefined,
		pendingVersion: previous && previous.version !== manifest.version ? manifest.version : undefined,
		rootPath: computePluginRootPath(manifest.id, options?.source ?? "archive", activeVersion),
	};
}

async function extractArchive(buffer: Buffer, targetDir: string): Promise<void> {
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	const zip = new AdmZip(buffer);
	zip.extractAllTo(targetDir, true);
}

async function getManifestFromDir(extractDir: string): Promise<{ manifest: PluginManifest; sourceDir: string }> {
	const directManifest = join(extractDir, "plugin.json");
	if (existsSync(directManifest)) {
		return {
			manifest: parseManifest(JSON.parse(readFileSync(directManifest, "utf-8"))),
			sourceDir: extractDir,
		};
	}
	const entries = await readdir(extractDir);
	const directories = entries
		.map((entry) => join(extractDir, entry))
		.filter((entryPath) => statSync(entryPath).isDirectory());
	if (directories.length === 1) {
		const manifestPathInCandidate = join(directories[0], "plugin.json");
		if (existsSync(manifestPathInCandidate)) {
			return {
				manifest: parseManifest(JSON.parse(readFileSync(manifestPathInCandidate, "utf-8"))),
				sourceDir: directories[0],
			};
		}
	}
	throw new Error("plugin.json not found at archive root");
}

async function copyExtractedPlugin(sourceDir: string, pluginId: string, version: string): Promise<void> {
	validatePluginVersion(version);
	const targetDir = join(pluginsBaseDir, pluginId, "versions", version);
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(dirname(targetDir), { recursive: true });
	await cp(sourceDir, targetDir, { recursive: true });
}

// =============================================================================
// 系统插件（ADR-0024）—— 随 App 发布、用户不可删改，源在 packages/plugins/presets
// =============================================================================

/** 系统插件只读根目录：打包后在 Resources，dev 下读取 zip 解压后的 staging。 */
function systemPluginsBaseDir(): string {
	return app.isPackaged
		? join(process.resourcesPath, "system-plugins")
		: join(process.cwd(), ".artifacts", "system-plugins");
}

function computePluginRootPath(pluginId: string, source: InstalledPlugin["source"], activeVersion: string): string {
	if (source === "system") {
		return join(systemPluginsBaseDir(), pluginId);
	}
	return join(pluginsBaseDir, pluginId, "versions", activeVersion);
}

/** ADR-0041: mode-gated plugins contribute only while their contribution mode is active. */
export function isPluginContributionModeActive(pluginId: string): boolean {
	if (!modeGatedPluginIds.has(pluginId)) return true;
	return activeContributionModeIds.has(pluginId);
}

export function registerPluginModeGate(pluginId: string): void {
	validatePluginId(pluginId);
	modeGatedPluginIds.add(pluginId);
}

export function setPluginContributionMode(pluginId: string, active: boolean): void {
	validatePluginId(pluginId);
	modeGatedPluginIds.add(pluginId);
	if (active) activeContributionModeIds.add(pluginId);
	else activeContributionModeIds.delete(pluginId);
}

function readSystemPrefs(): SystemPluginPrefs {
	if (!existsSync(systemPrefsPath)) return {};
	try {
		return JSON.parse(readFileSync(systemPrefsPath, "utf-8")) as SystemPluginPrefs;
	} catch {
		return {};
	}
}

function writeSystemPrefs(prefs: SystemPluginPrefs): void {
	ensureDir(dirname(systemPrefsPath));
	writeFileSync(systemPrefsPath, JSON.stringify(prefs, null, 2), "utf-8");
}

/** 系统插件资源 URL：无 versions/ 段（版本随 App，文件直接在 <base>/<id>/ 下）。 */
function toSystemPluginUrl(pluginId: string, relativePath: string, version: string): string {
	const normalized = validateRelativePath(relativePath, "path");
	const cacheVersion = app.isPackaged ? version : getSystemPluginResourceCacheVersion(pluginId, normalized, version);
	return `vetta-plugin://${pluginId}/${normalized}?v=${encodeURIComponent(cacheVersion)}`;
}

function getSystemPluginResourceCacheVersion(pluginId: string, relativePath: string, version: string): string {
	try {
		const resourcePath = join(systemPluginsBaseDir(), pluginId, relativePath);
		return `${version}-${Math.floor(statSync(resourcePath).mtimeMs)}`;
	} catch {
		return version;
	}
}

function hasGrantedPermission(plugin: InstalledPlugin, permission: PluginPermission): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}

function pluginResourceRelativePath(plugin: InstalledPlugin, relativePath: string): string {
	// 系统插件与 dev 链接插件的文件都在包根下，无 versions/ 段。
	return plugin.source === "system" || devLinks.has(plugin.id)
		? relativePath
		: versionedPath(plugin.activeVersion, relativePath);
}

// =============================================================================
// Dev 热更新链接（插件工作台）—— 纯内存态，不落注册表：App 重启即回落安装目录，
// 注册表始终保持可发布的安装态（避免崩溃后 entryUrl 指向不存在的工程目录）。
// =============================================================================

interface PluginDevLink {
	projectDir: string;
	manifest: PluginManifest;
	locales: PluginLocales;
	reloadToken: string;
	status: PluginDevWatchState["status"];
	error?: string;
}

const devLinks = new Map<string, PluginDevLink>();

/** dev 资源 URL：直接以工程根为根（无 versions/ 段），token 变化驱动 MF 强制重注册。 */
function toDevPluginUrl(pluginId: string, relativePath: string, token: string): string {
	const normalized = validateRelativePath(relativePath, "path");
	return `vetta-plugin://${pluginId}/${normalized}?v=dev&reload=${token}`;
}

/**
 * 把 dev 链接叠加到注册表对象上（entry/style/agent/locales/rootPath 改指工程）。
 *
 * Dev 期额外同步安装态字段（仅内存，不写注册表）：
 * - permissions / declaredCommands / settingsSchema 跟工程 plugin.json
 * - 新声明的权限与命令在热更新会话内自动视为已授权，避免「改了 permissions
 *   却必须重新安装」的开发摩擦；关热更新或重启后仍回落注册表安装态。
 * 正式发布 / 关热更新后的持久授权仍走「应用到 Vetta / 重新安装」。
 */
function applyDevOverlay(plugin: InstalledPlugin): InstalledPlugin {
	const link = devLinks.get(plugin.id);
	if (!link) return plugin;
	const manifest = link.manifest;
	const permissions = manifest.permissions ?? [];
	const declaredCommands = manifest.commands ?? [];
	// 热更新会话内：声明即放行（合并用户已授权集合，不收回已有授权）。
	const grantedPermissions = Array.from(new Set([...plugin.grantedPermissions, ...permissions]));
	const grantedCommandNames = Array.from(new Set([...(plugin.grantedCommandNames ?? []), ...declaredCommands]));
	return {
		...plugin,
		name: manifest.name,
		version: manifest.version,
		pluginApiVersion: manifest.pluginApiVersion,
		description: manifest.description,
		author: manifest.author,
		runtime: manifest.runtime ?? "esm",
		entryUrl: toDevPluginUrl(plugin.id, manifest.entry, link.reloadToken),
		moduleFederation: manifest.moduleFederation,
		agent: manifest.agent,
		agent_mode: manifest.agent_mode,
		styleUrls: (manifest.styles ?? []).map((style) => toDevPluginUrl(plugin.id, style, link.reloadToken)),
		iconUrl: resolveIconUrl(manifest.icon, (path) => toDevPluginUrl(plugin.id, path, link.reloadToken)),
		guidingWords: manifest.guidingWords,
		defaultLocale: manifest.defaultLocale ?? "zh",
		locales: link.locales,
		permissions,
		grantedPermissions,
		declaredCommands,
		grantedCommandNames,
		settingsSchema: manifest.contributes?.settings,
		rootPath: link.projectDir,
		devWatch: { projectDir: link.projectDir, status: link.status, error: link.error },
	};
}

function readDevProjectManifest(projectDir: string, expectedId: string): PluginManifest {
	const manifestFile = join(projectDir, "plugin.json");
	if (!existsSync(manifestFile)) {
		throw new Error(`plugin.json not found in ${projectDir}`);
	}
	const manifest = parseManifest(JSON.parse(readFileSync(manifestFile, "utf-8")));
	if (manifest.id !== expectedId) {
		throw new Error(`Project plugin id mismatch: expected ${expectedId}, got ${manifest.id}`);
	}
	return manifest;
}

/** 建立 dev 链接。要求插件已安装过一次（授权/启用沿用安装态）。 */
export function setPluginDevLink(id: string, projectDir: string): InstalledPlugin {
	validatePluginId(id);
	if (isSystemPluginId(id)) throw new Error(`Cannot dev-link a system plugin: ${id}`);
	const registry = readRegistry();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not installed (apply it once before enabling hot reload): ${id}`);
	const resolvedDir = resolve(projectDir);
	const manifest = readDevProjectManifest(resolvedDir, id);
	devLinks.set(id, {
		projectDir: resolvedDir,
		manifest,
		locales: loadPluginLocales(resolvedDir),
		reloadToken: Date.now().toString(),
		status: "starting",
	});
	broadcastPluginsChanged();
	return applyDevOverlay(plugin);
}

export function clearPluginDevLink(id: string): void {
	if (devLinks.delete(id)) broadcastPluginsChanged();
}

export function hasPluginDevLink(id: string): boolean {
	return devLinks.has(id);
}

/** dist 产物变化后：重读工程 manifest/locales，bump token，广播驱动渲染进程重载。 */
export function refreshPluginDevLink(id: string): InstalledPlugin {
	const link = devLinks.get(id);
	if (!link) throw new Error(`Plugin is not dev-linked: ${id}`);
	link.manifest = readDevProjectManifest(link.projectDir, id);
	link.locales = loadPluginLocales(link.projectDir);
	link.reloadToken = Date.now().toString();
	link.status = "running";
	link.error = undefined;
	const plugin = readRegistry()[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	broadcastPluginsChanged();
	return applyDevOverlay(plugin);
}

/** watcher/子进程状态回写（面板经 list() 感知）。链接不存在时静默忽略。 */
export function setPluginDevLinkStatus(id: string, status: PluginDevWatchState["status"], error?: string): void {
	const link = devLinks.get(id);
	if (!link) return;
	link.status = status;
	link.error = error;
	broadcastPluginsChanged();
}

function resolveInstalledPluginResource(plugin: InstalledPlugin, relativePath: string): string {
	return resolvePluginFilePath(plugin.id, pluginResourceRelativePath(plugin, relativePath));
}

function readPromptBlock(
	plugin: InstalledPlugin,
	relativePath: string,
	index: number,
	options?: { id?: string; priority?: number; enabled?: boolean },
): SystemPromptBlock {
	const content = readFileSync(resolveInstalledPluginResource(plugin, relativePath), "utf-8");
	return {
		id: options?.id ?? `plugin.${plugin.id}.systemPrompt.${index + 1}`,
		type: "plugin",
		source: { kind: "plugin", pluginId: plugin.id },
		content,
		priority: options?.priority ?? 850,
		enabled: options?.enabled ?? content.trim().length > 0,
	};
}

/** 当前全局工作模式（agent_mode 轴，纯全局态）。由 setPluginRuntimeAgentMode 更新，插件级硬闸据此过滤。见 ADR-0046。 */
let currentAgentMode: string | undefined;

/** 主进程记录当前全局工作模式，供 buildAgentPluginRuntimeConfig 的插件级硬闸使用。 */
export function setPluginRuntimeAgentMode(mode: string | undefined): void {
	currentAgentMode = mode;
}

/** manifest agent_mode（string | string[]）→ 归一化 string[]；空 → undefined（通用）。见 ADR-0046。 */
function normalizeAgentModeList(raw: unknown): string[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	const arr = (Array.isArray(raw) ? raw : [raw]).map((m) => String(m).trim()).filter((m) => m.length > 0);
	return arr.length > 0 ? arr : undefined;
}

/**
 * 插件级 agent_mode 硬闸：白名单外整个插件不可见（含 agent 贡献；UI/bundle 由 renderer 端过滤）。
 * 当前无 mode（CLI/headless）或插件未声明 = 放行。见 ADR-0046。
 */
function pluginMatchesAgentMode(plugin: InstalledPlugin): boolean {
	return pluginVisibleInAgentMode(plugin, currentAgentMode);
}

/**
 * 插件级 agent_mode 硬闸（纯函数版）：供 renderer 侧列表（UI/bundle）复用同一判定。
 * mode 为 undefined（CLI/headless）或插件未声明 = 放行。见 ADR-0046。
 */
export function pluginVisibleInAgentMode(
	plugin: Pick<InstalledPlugin, "agent_mode">,
	mode: string | undefined,
): boolean {
	if (mode === undefined) return true;
	const declared = normalizeAgentModeList(plugin.agent_mode);
	if (!declared || declared.length === 0) return true;
	return declared.includes(mode);
}

export function buildAgentPluginRuntimeConfig(): AgentPluginRuntimeConfig | undefined {
	const enabledPlugins = listPlugins().filter(
		(plugin) =>
			plugin.enabled && plugin.agent && isPluginContributionModeActive(plugin.id) && pluginMatchesAgentMode(plugin),
	);
	const enabledToolPlugins = listPlugins().filter(
		(plugin) => plugin.enabled && isPluginContributionModeActive(plugin.id) && pluginMatchesAgentMode(plugin),
	);
	debugPluginAgent("build runtime config start", {
		agentPlugins: enabledPlugins.map((plugin) => plugin.id),
		enabledPlugins: enabledToolPlugins.map((plugin) => plugin.id),
		dynamicToolPlugins: Array.from(dynamicAgentTools.entries()).map(([pluginId, tools]) => ({
			pluginId,
			tools: Array.from(tools.values()).map((tool) => tool.name),
		})),
	});
	const systemPromptContributions: NonNullable<AgentPluginRuntimeConfig["systemPromptContributions"]> = [];
	const skillPathContributions: NonNullable<AgentPluginRuntimeConfig["skillPathContributions"]> = [];
	const toolPolicyContributions: NonNullable<AgentPluginRuntimeConfig["toolPolicyContributions"]> = [];
	const toolContributions: NonNullable<AgentPluginRuntimeConfig["toolContributions"]> = [];
	const continuationContributions: NonNullable<AgentPluginRuntimeConfig["continuationContributions"]> = [];
	const systemPromptProviderContributions: NonNullable<AgentPluginRuntimeConfig["systemPromptProviderContributions"]> =
		[];
	const mcpServerContributions: McpServerContribution[] = [];

	for (const plugin of enabledPlugins) {
		try {
			const agent = plugin.agent;
			if (!agent) continue;
			if (
				agent.systemPrompt &&
				(hasGrantedPermission(plugin, "agent.systemPrompt.write") ||
					hasGrantedPermission(plugin, "agent.systemPrompt.fullControl"))
			) {
				const operations: SystemPromptOperation[] = (agent.systemPrompt.promptPaths ?? []).map((path, index) => ({
					type: "addBlock",
					block: readPromptBlock(plugin, path, index),
				}));
				if (operations.length > 0) {
					systemPromptContributions.push({
						pluginId: plugin.id,
						operations,
					});
				}
			}
			if (agent.skillPaths && hasGrantedPermission(plugin, "agent.skills.control")) {
				skillPathContributions.push({
					pluginId: plugin.id,
					paths: agent.skillPaths.map((path) => resolveInstalledPluginResource(plugin, path)),
				});
			}
			if (agent.toolPolicy && hasGrantedPermission(plugin, "agent.tools.control")) {
				toolPolicyContributions.push({
					pluginId: plugin.id,
					allow: agent.toolPolicy.allow,
					deny: agent.toolPolicy.deny,
				});
			}
			if (agent.mcpServers) {
				mcpServerContributions.push(...buildMcpServerContributionsForPlugin(plugin));
			}
		} catch (error) {
			pluginLog.warn(`Skipping agent contribution for ${plugin.id}:`, error);
		}
	}

	for (const plugin of enabledToolPlugins) {
		if (!hasGrantedPermission(plugin, "agent.tools.register")) {
			debugPluginAgent("skip tool contributions: missing register permission", { pluginId: plugin.id });
			continue;
		}
		if (!hasGrantedPermission(plugin, "agent.toolHandler.execute")) {
			debugPluginAgent("skip tool contributions: missing execute permission", { pluginId: plugin.id });
			continue;
		}
		const registeredTools = dynamicAgentTools.get(plugin.id);
		if (!registeredTools) {
			debugPluginAgent("skip tool contributions: no dynamic tools registered", { pluginId: plugin.id });
			continue;
		}
		for (const tool of registeredTools.values()) {
			const { activationId: _activationId, ...contribution } = tool;
			toolContributions.push({ ...contribution, pluginId: plugin.id });
		}
	}

	for (const plugin of enabledToolPlugins) {
		if (
			!hasGrantedPermission(plugin, "agent.systemPrompt.write") &&
			!hasGrantedPermission(plugin, "agent.systemPrompt.fullControl")
		) {
			continue;
		}
		for (const provider of dynamicSystemPromptProviders.get(plugin.id)?.values() ?? []) {
			const { activationId: _activationId, ...contribution } = provider;
			systemPromptProviderContributions.push({ ...contribution, pluginId: plugin.id });
		}
	}

	for (const plugin of enabledToolPlugins) {
		if (!hasGrantedPermission(plugin, "agent.continuation.register")) continue;
		const registeredProviders = dynamicContinuationProviders.get(plugin.id);
		if (!registeredProviders) continue;
		for (const provider of registeredProviders.values()) {
			const { activationId: _activationId, ...contribution } = provider;
			continuationContributions.push({ ...contribution, pluginId: plugin.id });
		}
	}

	const config: AgentPluginRuntimeConfig = {};
	if (systemPromptContributions.length > 0) config.systemPromptContributions = systemPromptContributions;
	if (skillPathContributions.length > 0) config.skillPathContributions = skillPathContributions;
	if (toolPolicyContributions.length > 0) config.toolPolicyContributions = toolPolicyContributions;
	if (toolContributions.length > 0) config.toolContributions = toolContributions;
	if (continuationContributions.length > 0) config.continuationContributions = continuationContributions;
	if (systemPromptProviderContributions.length > 0) {
		config.systemPromptProviderContributions = systemPromptProviderContributions;
	}
	if (mcpServerContributions.length > 0) config.mcpServerContributions = mcpServerContributions;
	const result = Object.keys(config).length > 0 ? config : undefined;
	debugPluginAgent("build runtime config done", summarizeRuntimeConfig(result));
	return result;
}

export function beginDynamicAgentContributionLoad(pluginId: string, activationId: string): void {
	validatePluginId(pluginId);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	dynamicAgentActivations.set(pluginId, activationId);
	const previousToolCount = dynamicAgentTools.get(pluginId)?.size ?? 0;
	const previousContinuationCount = dynamicContinuationProviders.get(pluginId)?.size ?? 0;
	dynamicAgentTools.delete(pluginId);
	dynamicContinuationProviders.delete(pluginId);
	dynamicSystemPromptProviders.delete(pluginId);
	debugPluginAgent("dynamic agent contribution activation began", {
		pluginId,
		activationId,
		previousToolCount,
		previousContinuationCount,
	});
}

export function registerDynamicAgentTool(pluginId: string, tool: RegisteredAgentTool): void {
	validatePluginId(pluginId);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (!hasGrantedPermission(plugin, "agent.tools.register")) {
		throw new Error(`Plugin permission denied: agent.tools.register`);
	}
	const currentActivationId = dynamicAgentActivations.get(pluginId);
	if (tool.activationId && currentActivationId && tool.activationId !== currentActivationId) {
		debugPluginAgent("ignore stale dynamic tool register", {
			pluginId,
			toolId: tool.id,
			toolName: tool.name,
			activationId: tool.activationId,
			currentActivationId,
		});
		return;
	}
	let tools = dynamicAgentTools.get(pluginId);
	if (!tools) {
		tools = new Map();
		dynamicAgentTools.set(pluginId, tools);
	}
	tools.set(tool.id, tool);
	debugPluginAgent("dynamic tool registered", {
		pluginId,
		toolId: tool.id,
		toolName: tool.name,
		handlerId: tool.handlerId,
		activationId: tool.activationId,
		pluginToolCount: tools.size,
	});
}

export function unregisterDynamicAgentTool(pluginId: string, toolId: string, activationId?: string): void {
	validatePluginId(pluginId);
	const currentActivationId = dynamicAgentActivations.get(pluginId);
	if (activationId && currentActivationId && activationId !== currentActivationId) {
		debugPluginAgent("ignore stale dynamic tool unregister", {
			pluginId,
			toolId,
			activationId,
			currentActivationId,
		});
		return;
	}
	const tools = dynamicAgentTools.get(pluginId);
	if (!tools) return;
	const tool = tools.get(toolId);
	if (activationId && tool?.activationId && tool.activationId !== activationId) {
		debugPluginAgent("ignore mismatched dynamic tool unregister", {
			pluginId,
			toolId,
			activationId,
			toolActivationId: tool.activationId,
		});
		return;
	}
	tools.delete(toolId);
	if (tools.size === 0) dynamicAgentTools.delete(pluginId);
	debugPluginAgent("dynamic tool unregistered", {
		pluginId,
		toolId,
		remainingPluginToolCount: dynamicAgentTools.get(pluginId)?.size ?? 0,
	});
}

export function registerDynamicContinuationProvider(pluginId: string, provider: RegisteredContinuationProvider): void {
	validatePluginId(pluginId);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (!hasGrantedPermission(plugin, "agent.continuation.register")) {
		throw new Error("Plugin permission denied: agent.continuation.register");
	}
	const currentActivationId = dynamicAgentActivations.get(pluginId);
	if (provider.activationId && currentActivationId && provider.activationId !== currentActivationId) return;
	let providers = dynamicContinuationProviders.get(pluginId);
	if (!providers) {
		providers = new Map();
		dynamicContinuationProviders.set(pluginId, providers);
	}
	providers.set(provider.id, provider);
}

export function registerDynamicSystemPromptProvider(pluginId: string, provider: RegisteredSystemPromptProvider): void {
	validatePluginId(pluginId);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (
		!hasGrantedPermission(plugin, "agent.systemPrompt.write") &&
		!hasGrantedPermission(plugin, "agent.systemPrompt.fullControl")
	) {
		throw new Error("Plugin permission denied: agent.systemPrompt.write");
	}
	const currentActivationId = dynamicAgentActivations.get(pluginId);
	if (provider.activationId && currentActivationId && provider.activationId !== currentActivationId) return;
	let providers = dynamicSystemPromptProviders.get(pluginId);
	if (!providers) {
		providers = new Map();
		dynamicSystemPromptProviders.set(pluginId, providers);
	}
	providers.set(provider.id, provider);
	pluginLog.debug("[plugin-system-prompt] provider registered", {
		pluginId,
		providerId: provider.id,
		handlerId: provider.handlerId,
		activationId: provider.activationId,
		timeoutMs: provider.timeoutMs,
		providerCount: providers.size,
	});
}

export function unregisterDynamicSystemPromptProvider(
	pluginId: string,
	providerId: string,
	activationId?: string,
): void {
	validatePluginId(pluginId);
	const currentActivationId = dynamicAgentActivations.get(pluginId);
	if (activationId && currentActivationId && activationId !== currentActivationId) return;
	const providers = dynamicSystemPromptProviders.get(pluginId);
	if (!providers) return;
	const provider = providers.get(providerId);
	if (activationId && provider?.activationId && provider.activationId !== activationId) return;
	providers.delete(providerId);
	if (providers.size === 0) dynamicSystemPromptProviders.delete(pluginId);
	pluginLog.debug("[plugin-system-prompt] provider unregistered", {
		pluginId,
		providerId,
		activationId,
		remainingProviderCount: providers.size,
	});
}

export function unregisterDynamicContinuationProvider(
	pluginId: string,
	providerId: string,
	activationId?: string,
): void {
	validatePluginId(pluginId);
	const currentActivationId = dynamicAgentActivations.get(pluginId);
	if (activationId && currentActivationId && activationId !== currentActivationId) return;
	const providers = dynamicContinuationProviders.get(pluginId);
	if (!providers) return;
	const provider = providers.get(providerId);
	if (activationId && provider?.activationId && provider.activationId !== activationId) return;
	providers.delete(providerId);
	if (providers.size === 0) dynamicContinuationProviders.delete(pluginId);
}

export function clearDynamicAgentContributions(pluginId: string, activationId?: string): void {
	validatePluginId(pluginId);
	const currentActivationId = dynamicAgentActivations.get(pluginId);
	if (activationId && currentActivationId && activationId !== currentActivationId) {
		debugPluginAgent("ignore stale dynamic tools clear", {
			pluginId,
			activationId,
			currentActivationId,
		});
		return;
	}
	const previousToolCount = dynamicAgentTools.get(pluginId)?.size ?? 0;
	const previousContinuationCount = dynamicContinuationProviders.get(pluginId)?.size ?? 0;
	dynamicAgentTools.delete(pluginId);
	dynamicContinuationProviders.delete(pluginId);
	dynamicSystemPromptProviders.delete(pluginId);
	if (!activationId || currentActivationId === activationId) {
		dynamicAgentActivations.delete(pluginId);
	}
	debugPluginAgent("dynamic agent contributions cleared", {
		pluginId,
		activationId,
		previousToolCount,
		previousContinuationCount,
	});
}

function systemInstalledFromManifest(
	manifest: PluginManifest,
	enabled: boolean,
	locales: PluginLocales,
	disabledCommands: string[] = [],
): InstalledPlugin {
	if (!supportsPluginApi(manifest.pluginApiVersion)) {
		throw new Error(`Unsupported plugin API version: ${manifest.pluginApiVersion}`);
	}
	const now = new Date().toISOString();
	const required = REQUIRED_SYSTEM_PLUGIN_IDS.has(manifest.id);
	const declaredCommands = manifest.commands ?? [];
	// System plugins auto-grant declared commands; the user may still disable any
	// of them (persisted in system-plugin-prefs.json, not the user registry).
	const grantedCommandNames = declaredCommands.filter((name) => !disabledCommands.includes(name));
	return {
		id: manifest.id,
		name: manifest.name,
		version: manifest.version,
		activeVersion: manifest.version,
		pluginApiVersion: manifest.pluginApiVersion,
		runtime: manifest.runtime ?? "esm",
		entryUrl: toSystemPluginUrl(manifest.id, manifest.entry, manifest.version),
		moduleFederation: manifest.moduleFederation,
		agent: manifest.agent,
		agent_mode: manifest.agent_mode,
		styleUrls: (manifest.styles ?? []).map((style) => toSystemPluginUrl(manifest.id, style, manifest.version)),
		permissions: manifest.permissions ?? [],
		// 系统插件随包发的可信代码：声明权限全部自动授予，用户不可撤（ADR-0024）。
		grantedPermissions: manifest.permissions ?? [],
		declaredCommands,
		grantedCommandNames,
		settingsSchema: manifest.contributes?.settings,
		description: manifest.description,
		author: manifest.author,
		iconUrl: resolveIconUrl(manifest.icon, (path) => toSystemPluginUrl(manifest.id, path, manifest.version)),
		guidingWords: manifest.guidingWords,
		defaultLocale: manifest.defaultLocale ?? "zh",
		locales,
		enabled: required || enabled,
		required,
		installedAt: now,
		updatedAt: now,
		source: "system",
		trustLevel: "official",
		rootPath: computePluginRootPath(manifest.id, "system", manifest.version),
	};
}

let systemPluginsCache: InstalledPlugin[] | null = null;
const systemPluginIds = new Set<string>();

/** 扫描系统插件根目录，合成只读记录并缓存 id 集合（供解析器与冲突门控用）。 */
export function discoverSystemPlugins(force = false): InstalledPlugin[] {
	if (systemPluginsCache && !force) return systemPluginsCache;
	const baseDir = systemPluginsBaseDir();
	const result: InstalledPlugin[] = [];
	systemPluginIds.clear();
	if (existsSync(baseDir)) {
		const prefs = readSystemPrefs();
		for (const entry of readdirSync(baseDir)) {
			const dir = join(baseDir, entry);
			try {
				if (!statSync(dir).isDirectory()) continue;
				const manifestFile = join(dir, "plugin.json");
				if (!existsSync(manifestFile)) continue;
				const manifest = parseManifest(JSON.parse(readFileSync(manifestFile, "utf-8")));
				// staging 不完整时跳过并告警，不阻断启动。
				if (!existsSync(join(dir, manifest.entry))) {
					pluginLog.warn(`discover: 跳过 ${manifest.id}：staging 缺少入口 (${manifest.entry})`);
					continue;
				}
				if (manifest.contributionMode?.hardIsolation) {
					// Gate before renderer activate so skills/MCP never leak on cold start (ADR-0041).
					modeGatedPluginIds.add(manifest.id);
				}
				result.push(
					systemInstalledFromManifest(
						manifest,
						prefs[manifest.id]?.enabled ?? true,
						loadPluginLocales(dir),
						prefs[manifest.id]?.disabledCommands ?? [],
					),
				);
				systemPluginIds.add(manifest.id);
			} catch (err) {
				pluginLog.warn(`discover: 跳过 ${entry}：`, err);
			}
		}
	}
	systemPluginsCache = result;
	return result;
}

export function isSystemPluginId(id: string): boolean {
	if (!systemPluginsCache) discoverSystemPlugins();
	return systemPluginIds.has(id);
}

export function getPluginsBaseDir(): string {
	return pluginsBaseDir;
}

// =============================================================================
// 插件设置（VSCode 式）—— 按 plugin id 命名空间存值，与声明 schema 分离。
// =============================================================================

const pluginSettingsPath = join(getVettaHomePath(), "plugin-settings.json");
type PluginSettingsStore = Record<string, Record<string, unknown>>;

function readPluginSettingsStore(): PluginSettingsStore {
	if (!existsSync(pluginSettingsPath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(pluginSettingsPath, "utf-8")) as PluginSettingsStore;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writePluginSettingsStore(store: PluginSettingsStore): void {
	ensureDir(dirname(pluginSettingsPath));
	writeFileSync(pluginSettingsPath, JSON.stringify(store, null, 2), "utf-8");
}

/** Effective values: schema defaults merged with stored values (stored wins). */
export function getPluginSettings(pluginId: string): Record<string, unknown> {
	validatePluginId(pluginId);
	const stored = readPluginSettingsStore()[pluginId] ?? {};
	const schema = listPlugins().find((plugin) => plugin.id === pluginId)?.settingsSchema ?? [];
	const defaults: Record<string, unknown> = {};
	for (const setting of schema) {
		if (setting.default !== undefined) defaults[setting.key] = setting.default;
	}
	return { ...defaults, ...stored };
}

/** Merge values over the stored namespace; returns the new effective values. */
export function setPluginSettings(pluginId: string, values: Record<string, unknown>): Record<string, unknown> {
	validatePluginId(pluginId);
	if (values == null || typeof values !== "object" || Array.isArray(values)) {
		throw new Error("Invalid plugin settings values");
	}
	const store = readPluginSettingsStore();
	store[pluginId] = { ...(store[pluginId] ?? {}), ...values };
	writePluginSettingsStore(store);
	return getPluginSettings(pluginId);
}

export function listPlugins(): InstalledPlugin[] {
	const system = discoverSystemPlugins();
	const reserved = new Set(system.map((plugin) => plugin.id));
	// id 冲突时系统插件遮蔽用户插件（ADR-0024）。
	const userPlugins = Object.values(readRegistry())
		.filter((plugin) => !reserved.has(plugin.id))
		.map(applyDevOverlay);
	return [...system, ...userPlugins].sort((a, b) => a.name.localeCompare(b.name));
}

export async function installPluginFromArchive(
	archiveBuffer: ArrayBuffer | Buffer,
	options?: PluginInstallOptions,
): Promise<InstalledPlugin> {
	const buffer = Buffer.isBuffer(archiveBuffer) ? archiveBuffer : Buffer.from(archiveBuffer);
	verifySha256(buffer, options?.expectedSha256, "插件安装包");
	const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const extractDir = join(tmpBaseDir, `_install_${stamp}`);
	await extractArchive(buffer, extractDir);
	try {
		const { manifest, sourceDir } = await getManifestFromDir(extractDir);
		if (isSystemPluginId(manifest.id)) {
			throw new Error(`Cannot install over a system plugin: ${manifest.id}`);
		}
		const registry = readRegistry();
		const previous = registry[manifest.id];
		await copyExtractedPlugin(sourceDir, manifest.id, manifest.version);
		let installed = installedFromManifest(manifest, options, previous, loadPluginLocales(sourceDir));
		// Fresh install with explicit grants: if caller passed permissions, keep them.
		// ADR-0042 agent path typically grants all declared permissions at approve time.
		if (options?.grantedPermissions && options.grantedPermissions.length > 0) {
			const allowed = new Set(manifest.permissions ?? []);
			installed = {
				...installed,
				grantedPermissions: options.grantedPermissions.filter((p) => allowed.has(p)),
			};
		}
		if (manifest.contributionMode?.hardIsolation) {
			modeGatedPluginIds.add(manifest.id);
		}
		registry[manifest.id] = installed;
		writeRegistry(registry);
		// 能力安装台账（ADR-0049）：记生效中的版本；升级要等 reloadPlugin 切到 pendingVersion 后才改写。
		recordAbilityInstall("plugin", installed.id, installed.activeVersion);
		broadcastPluginsChanged();
		return installed;
	} finally {
		await rm(extractDir, { recursive: true, force: true }).catch(() => {});
	}
}

export async function installPluginFromUrl(url: string, options?: PluginInstallOptions): Promise<InstalledPlugin> {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("Plugin URL must use http or https");
	}
	const response = await fetch(parsed);
	if (!response.ok) {
		throw new Error(`Failed to download plugin: ${response.status}`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());
	return installPluginFromArchive(buffer, { ...options, source: "remote" });
}

/** Install from a local zip path (ADR-0042). */
export async function installPluginFromPath(
	filePath: string,
	options?: PluginInstallOptions,
): Promise<InstalledPlugin> {
	if (typeof filePath !== "string" || filePath.trim().length === 0) {
		throw new Error("Plugin path is required");
	}
	const resolved = isAbsolute(filePath) ? filePath : resolve(filePath);
	if (!existsSync(resolved)) {
		throw new Error(`Plugin archive not found: ${resolved}`);
	}
	if (!resolved.toLowerCase().endsWith(".zip")) {
		throw new Error("Plugin path must be a .zip archive");
	}
	const buffer = await readFile(resolved);
	return installPluginFromArchive(buffer, { ...options, source: options?.source ?? "archive" });
}

export function uninstallPlugin(id: string): void {
	validatePluginId(id);
	if (isSystemPluginId(id)) throw new Error(`Cannot uninstall a system plugin: ${id}`);
	// 卸载即断开 dev 链接（watcher/子进程由 ipc 层的 dev-watch 管理器同步停掉）。
	devLinks.delete(id);
	const registry = readRegistry();
	delete registry[id];
	writeRegistry(registry);
	removeAbilityLedgerEntry("plugin", id);
	rmSync(join(pluginsBaseDir, id), { recursive: true, force: true });
	broadcastPluginsChanged();
}

export function setPluginEnabled(id: string, enabled: boolean): InstalledPlugin {
	validatePluginId(id);
	if (!enabled && REQUIRED_SYSTEM_PLUGIN_IDS.has(id)) {
		throw new Error(`Required system plugin cannot be disabled: ${id}`);
	}
	// 系统插件可停用但不可删改：偏好写进独立的 prefs 文件，本体不入注册表（ADR-0024）。
	if (isSystemPluginId(id)) {
		const prefs = readSystemPrefs();
		prefs[id] = { ...prefs[id], enabled };
		writeSystemPrefs(prefs);
		const refreshed = discoverSystemPlugins(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		broadcastPluginsChanged();
		return refreshed;
	}
	const registry = readRegistry();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	plugin.enabled = enabled;
	plugin.updatedAt = new Date().toISOString();
	writeRegistry(registry);
	broadcastPluginsChanged();
	return plugin;
}

export function grantPluginPermissions(id: string, permissions: PluginPermission[]): InstalledPlugin {
	validatePluginId(id);
	if (isSystemPluginId(id)) throw new Error(`System plugin permissions are managed automatically: ${id}`);
	const registry = readRegistry();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	const allowed = new Set(plugin.permissions);
	plugin.grantedPermissions = Array.from(
		new Set([...plugin.grantedPermissions, ...permissions.filter((p) => allowed.has(p))]),
	);
	plugin.updatedAt = new Date().toISOString();
	writeRegistry(registry);
	broadcastPluginsChanged();
	return plugin;
}

export function revokePluginPermissions(id: string, permissions: PluginPermission[]): InstalledPlugin {
	validatePluginId(id);
	if (isSystemPluginId(id)) throw new Error(`System plugin permissions are managed automatically: ${id}`);
	const registry = readRegistry();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	const revoked = new Set(permissions);
	plugin.grantedPermissions = plugin.grantedPermissions.filter((permission) => !revoked.has(permission));
	plugin.updatedAt = new Date().toISOString();
	writeRegistry(registry);
	broadcastPluginsChanged();
	return plugin;
}

/**
 * Enable declared command names. User plugins update the registry's
 * grantedCommandNames; system plugins clear those names from the prefs'
 * disabledCommands list (declared commands are auto-granted).
 */
export function grantPluginCommands(id: string, names: string[]): InstalledPlugin {
	validatePluginId(id);
	const requested = parseCommands(names);
	if (isSystemPluginId(id)) {
		const current = discoverSystemPlugins().find((plugin) => plugin.id === id);
		if (!current) throw new Error(`Plugin not found: ${id}`);
		const declared = new Set(current.declaredCommands);
		const prefs = readSystemPrefs();
		const prev = prefs[id]?.disabledCommands ?? [];
		const next = prev.filter((name) => !requested.includes(name) && declared.has(name));
		prefs[id] = { enabled: prefs[id]?.enabled ?? current.enabled, disabledCommands: next };
		writeSystemPrefs(prefs);
		const refreshed = discoverSystemPlugins(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		return refreshed;
	}
	const registry = readRegistry();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	const declared = new Set(plugin.declaredCommands);
	plugin.grantedCommandNames = Array.from(
		new Set([...plugin.grantedCommandNames, ...requested.filter((name) => declared.has(name))]),
	);
	plugin.updatedAt = new Date().toISOString();
	writeRegistry(registry);
	return plugin;
}

/** Disable declared command names. Inverse of {@link grantPluginCommands}. */
export function revokePluginCommands(id: string, names: string[]): InstalledPlugin {
	validatePluginId(id);
	const requested = parseCommands(names);
	if (isSystemPluginId(id)) {
		const current = discoverSystemPlugins().find((plugin) => plugin.id === id);
		if (!current) throw new Error(`Plugin not found: ${id}`);
		const declared = new Set(current.declaredCommands);
		const prefs = readSystemPrefs();
		const prev = prefs[id]?.disabledCommands ?? [];
		const next = Array.from(new Set([...prev, ...requested.filter((name) => declared.has(name))]));
		prefs[id] = { enabled: prefs[id]?.enabled ?? current.enabled, disabledCommands: next };
		writeSystemPrefs(prefs);
		const refreshed = discoverSystemPlugins(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		return refreshed;
	}
	const registry = readRegistry();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	const revoked = new Set(requested);
	plugin.grantedCommandNames = plugin.grantedCommandNames.filter((name) => !revoked.has(name));
	plugin.updatedAt = new Date().toISOString();
	writeRegistry(registry);
	return plugin;
}

export function reloadPlugin(id: string): InstalledPlugin {
	validatePluginId(id);
	// 系统插件版本随 App，无 pending 更新流（ADR-0024）。
	if (isSystemPluginId(id)) {
		const refreshed = discoverSystemPlugins(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		broadcastPluginsChanged();
		return refreshed;
	}
	const registry = readRegistry();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	plugin.activeVersion = plugin.pendingVersion ?? plugin.version;
	plugin.pendingVersion = undefined;
	plugin.availableVersion = undefined;
	const versionDir = join(pluginsBaseDir, plugin.id, "versions", plugin.activeVersion);
	const manifestFile = join(versionDir, "plugin.json");
	const manifest = parseManifest(JSON.parse(readFileSync(manifestFile, "utf-8")));
	plugin.defaultLocale = manifest.defaultLocale ?? "zh";
	plugin.locales = loadPluginLocales(versionDir);
	plugin.runtime = manifest.runtime ?? "esm";
	const reloadToken = Date.now().toString();
	plugin.entryUrl = `${toPluginUrl(plugin.id, plugin.activeVersion, manifest.entry)}&reload=${reloadToken}`;
	plugin.moduleFederation = manifest.moduleFederation;
	plugin.agent = manifest.agent;
	plugin.styleUrls = (manifest.styles ?? []).map(
		(style) => `${toPluginUrl(plugin.id, plugin.activeVersion, style)}&reload=${reloadToken}`,
	);
	// activeVersion 在上面已切到 pendingVersion，图标 URL 必须跟着重算（安装时刻意沿用了旧值）。
	plugin.iconUrl = resolveIconUrl(
		manifest.icon,
		(path) => `${toPluginUrl(plugin.id, plugin.activeVersion, path)}&reload=${reloadToken}`,
	);
	// 重载到新版本时同步命令声明，并把用户授权裁剪到新声明集合内（避免授权指向已移除的命令、
	// 或新增命令因 declaredCommands 陈旧而永远无法授权）。
	plugin.declaredCommands = manifest.commands ?? [];
	plugin.grantedCommandNames = (plugin.grantedCommandNames ?? []).filter((name) =>
		plugin.declaredCommands.includes(name),
	);
	plugin.rootPath = computePluginRootPath(plugin.id, plugin.source, plugin.activeVersion);
	plugin.updatedAt = new Date().toISOString();
	writeRegistry(registry);
	// activeVersion 已切到 pendingVersion，台账（ADR-0049）跟着改写为实际生效的版本。
	recordAbilityInstall("plugin", plugin.id, plugin.activeVersion);
	// dev 链接期间：注册表照常应用 pendingVersion（否则「应用到 Vetta」的新版本会被
	// 吞掉，关热更新后回落旧版本），但返回值与广播叠加 dev 快照（资源仍从工程加载）。
	if (devLinks.has(id)) {
		return refreshPluginDevLink(id);
	}
	broadcastPluginsChanged();
	return plugin;
}

export function resolvePluginFilePath(pluginId: string, relativePath: string): string {
	validatePluginId(pluginId);
	// dev 链接优先：协议请求直接映射到开发工程目录（越界检查同样生效）。
	const devLink = devLinks.get(pluginId);
	const baseDir = isSystemPluginId(pluginId) ? systemPluginsBaseDir() : pluginsBaseDir;
	const root = devLink ? devLink.projectDir : resolve(baseDir, pluginId);
	const target = resolve(root, relativePath);
	if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
		throw new Error("Plugin file path escapes plugin directory");
	}
	return target;
}
