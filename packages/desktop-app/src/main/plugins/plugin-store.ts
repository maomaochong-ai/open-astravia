import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { AgentPluginRuntimeConfig } from "@vetta/runtime-core";
import {
	isPluginApiCompatible,
	parsePluginCommandNames as parseCommands,
	parsePluginManifest as parseManifest,
	validatePluginId,
	validatePluginRelativePath as validateRelativePath,
} from "@vetta-org/plugin-sdk/manifest";
import { app, webContents } from "electron";
import type {
	InstalledPlugin,
	PluginDevWatchState,
	PluginInstallOptions,
	PluginLocales,
	PluginManifest,
	PluginPermission,
	PluginSettingSchema,
	PluginsChangedEvent,
} from "../../preload/api-types/plugins.js";
import { PLUGIN_CONTRIBUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { recordAbilityInstall, removeAbilityLedgerEntry } from "../abilities/ability-ledger.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import { verifySha256 } from "../utils/integrity.js";
import { type DesktopPluginHookRegistration, desktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
import {
	PluginAgentContributionRegistry,
	type RegisteredAgentTool,
	type RegisteredContinuationProvider,
	type RegisteredSystemPromptProvider,
} from "./plugin-agent-contribution-registry.js";
import { pluginVisibleInAgentMode } from "./plugin-agent-mode-policy.js";
import { normalizePluginDevServerUrls } from "./plugin-dev-protocol.js";
import { assertPluginInstallIdentity } from "./plugin-install-options.js";
import {
	copyPluginPackage,
	createInstalledPluginFromManifest,
	extractPluginArchive,
	findPluginManifest,
	readPluginLocales,
	resolvePluginIcon,
	toInstalledPluginUrl,
	validatePluginPackageResources,
	versionedPluginPath,
} from "./plugin-package.js";
import { effectivePluginCommands, effectivePluginPermissions } from "./plugin-permission-policy.js";
import { PluginRegistryStore, SystemPluginPreferenceStore } from "./plugin-registry-store.js";
import { buildPluginRuntimeConfig } from "./plugin-runtime-config-builder.js";
import { PluginSettingsStore } from "./plugin-settings-store.js";

export const PLUGIN_API_VERSION = "1.3.0";
export const CORE_ACTION_PLUGIN_ID = "vetta-actions";

function supportsPluginApi(range: string): boolean {
	return isPluginApiCompatible(PLUGIN_API_VERSION, range);
}

const REQUIRED_SYSTEM_PLUGIN_IDS = new Set<string>([CORE_ACTION_PLUGIN_ID]);
const pluginsBaseDir = join(getVettaHomePath(), "plugins");
const manifestPath = join(getVettaHomePath(), "plugins-manifest.json");
const tmpBaseDir = join(getVettaHomePath(), "tmp", "plugins");
// 系统插件的用户态偏好（目前仅停用开关），与用户插件注册表分离（ADR-0024）。
const systemPrefsPath = join(getVettaHomePath(), "system-plugin-prefs.json");
const pluginRegistry = new PluginRegistryStore(manifestPath, pluginsBaseDir);
const systemPluginPreferences = new SystemPluginPreferenceStore(systemPrefsPath);

const pluginLog = getAppLogger("plugin");
const pluginAgentContributions = new PluginAgentContributionRegistry(desktopPluginHookRegistry);
/** Plugins that hard-isolate agent contributions until contribution mode is on (ADR-0041). */
const modeGatedPluginIds = new Set<string>();
/** Subset of mode-gated plugins currently active (toggle on). */
const activeContributionModeIds = new Set<string>();

/**
 * Tell every renderer to re-list and re-load plugins (MF remotes + activity tabs).
 * Without this, install/enable via Action or workbench leaves the UI on the pre-install set.
 */
export function broadcastPluginsChanged(event?: PluginsChangedEvent): void {
	for (const contents of webContents.getAllWebContents()) {
		if (contents.isDestroyed()) continue;
		try {
			contents.send(PLUGIN_CONTRIBUTION_CHANNELS.PLUGINS_CHANGED, event);
		} catch {
			// ignore gone frames
		}
	}
}
function debugPluginAgent(message: string, data?: Record<string, unknown>): void {
	pluginLog.debug(message, data ?? {});
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
		: versionedPluginPath(plugin.activeVersion, relativePath);
}

// =============================================================================
// Dev 热更新链接——纯内存态，不落注册表：App 重启即回落安装目录，
// 注册表始终保持可发布的安装态（避免崩溃后 entryUrl 指向不存在的工程目录）。
// =============================================================================

interface PluginDevLink {
	projectDir: string;
	manifest: PluginManifest;
	locales: PluginLocales;
	reloadToken: string;
	ephemeral: boolean;
	entryUrl?: string;
	origin?: string;
	status: PluginDevWatchState["status"];
	error?: string;
}

const devLinks = new Map<string, PluginDevLink>();
const ephemeralDevPlugins = new Map<string, InstalledPlugin>();

export interface SetPluginDevLinkOptions {
	/** Allow an explicitly selected development project to exist without a persisted install record. */
	allowUninstalled?: boolean;
}

/** dev 资源 URL：直接以工程根为根（无 versions/ 段），token 变化驱动 MF 强制重注册。 */
function toDevPluginUrl(pluginId: string, relativePath: string, token: string): string {
	const normalized = validateRelativePath(relativePath, "path");
	return `vetta-plugin://${pluginId}/${normalized}?v=dev&reload=${token}`;
}

/**
 * 把 dev 链接叠加到已安装插件快照上（entry/style/agent/locales/rootPath 改指工程）。
 *
 * Dev 期额外同步安装态字段（仅内存，不写注册表）：
 * - permissions / declaredCommands / settingsSchema 跟工程 plugin.json
 * - 新声明的普通权限在热更新会话内自动视为已授权，避免「改了 permissions
 *   却必须重新安装」的开发摩擦；命令权限仍只给 official 插件。
 * 正式发布 / 关热更新后的持久授权仍走「应用到 Vetta / 重新安装」。
 */
function applyDevOverlay(plugin: InstalledPlugin): InstalledPlugin {
	const link = devLinks.get(plugin.id);
	if (!link) return plugin;
	const devWatch: PluginDevWatchState = {
		projectDir: link.projectDir,
		entryUrl: link.entryUrl,
		origin: link.origin,
		status: link.status,
		error: link.error,
	};
	// Keep the installed/staged snapshot active until the candidate server has
	// completed the versioned ready handshake.
	if (!link.entryUrl || !link.origin) {
		return {
			...plugin,
			enabled: link.ephemeral ? false : plugin.enabled,
			devWatch,
		};
	}
	const manifest = link.manifest;
	const permissions = effectivePluginPermissions(manifest.permissions ?? [], plugin.trustLevel);
	const declaredCommands = effectivePluginCommands(manifest.commands ?? [], plugin.trustLevel);
	// 热更新会话内：声明即放行（合并用户已授权集合，不收回已有授权）。
	const grantedPermissions = effectivePluginPermissions(
		Array.from(new Set([...plugin.grantedPermissions, ...permissions])),
		plugin.trustLevel,
	);
	const grantedCommandNames = effectivePluginCommands(
		Array.from(new Set([...(plugin.grantedCommandNames ?? []), ...declaredCommands])),
		plugin.trustLevel,
	);
	return {
		...plugin,
		name: manifest.name,
		version: manifest.version,
		pluginApiVersion: manifest.pluginApiVersion,
		description: manifest.description,
		author: manifest.author,
		runtime: manifest.runtime ?? "esm",
		entryUrl: link.entryUrl ?? toDevPluginUrl(plugin.id, manifest.entry, link.reloadToken),
		moduleFederation: manifest.moduleFederation,
		agent: manifest.agent,
		agent_mode: manifest.agent_mode,
		styleUrls: link.entryUrl
			? []
			: (manifest.styles ?? []).map((style) => toDevPluginUrl(plugin.id, style, link.reloadToken)),
		iconUrl: resolvePluginIcon(manifest.icon, (path) => toDevPluginUrl(plugin.id, path, link.reloadToken)),
		guidingWords: manifest.guidingWords,
		defaultLocale: manifest.defaultLocale ?? "zh",
		locales: link.locales,
		permissions,
		grantedPermissions,
		allowedNetworkHosts: manifest.network?.allowedHosts ?? [],
		declaredCommands,
		grantedCommandNames,
		settingsSchema: manifest.contributes?.settings,
		rootPath: link.projectDir,
		enabled: link.ephemeral ? true : plugin.enabled,
		devWatch,
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

function ephemeralInstalledFromManifest(projectDir: string, manifest: PluginManifest): InstalledPlugin {
	if (!supportsPluginApi(manifest.pluginApiVersion)) {
		throw new Error(`Unsupported plugin API version: ${manifest.pluginApiVersion}`);
	}
	const now = new Date().toISOString();
	const permissions = effectivePluginPermissions(manifest.permissions ?? [], "local");
	return {
		id: manifest.id,
		name: manifest.name,
		version: manifest.version,
		activeVersion: manifest.version,
		pluginApiVersion: manifest.pluginApiVersion,
		runtime: manifest.runtime ?? "esm",
		entryUrl: toDevPluginUrl(manifest.id, manifest.entry, now),
		moduleFederation: manifest.moduleFederation,
		agent: manifest.agent,
		agent_mode: manifest.agent_mode,
		styleUrls: (manifest.styles ?? []).map((style) => toDevPluginUrl(manifest.id, style, now)),
		permissions,
		grantedPermissions: permissions,
		allowedNetworkHosts: manifest.network?.allowedHosts ?? [],
		declaredCommands: [],
		grantedCommandNames: [],
		settingsSchema: manifest.contributes?.settings,
		description: manifest.description,
		author: manifest.author,
		iconUrl: resolvePluginIcon(manifest.icon, (path) => toDevPluginUrl(manifest.id, path, now)),
		guidingWords: manifest.guidingWords,
		defaultLocale: manifest.defaultLocale ?? "zh",
		locales: readPluginLocales(projectDir, pluginLog),
		enabled: true,
		required: false,
		installedAt: now,
		updatedAt: now,
		source: "archive",
		trustLevel: "local",
		rootPath: projectDir,
	};
}

function getInstalledPluginForDevLink(id: string): InstalledPlugin | undefined {
	return (
		discoverSystemPlugins().find((plugin) => plugin.id === id) ??
		pluginRegistry.read()[id] ??
		ephemeralDevPlugins.get(id)
	);
}

/** 建立 dev 链接。系统插件沿用随包状态，用户插件要求已安装过一次。 */
export function setPluginDevLink(
	id: string,
	projectDir: string,
	options: SetPluginDevLinkOptions = {},
): InstalledPlugin {
	validatePluginId(id);
	const resolvedDir = resolve(projectDir);
	const manifest = readDevProjectManifest(resolvedDir, id);
	let plugin = getInstalledPluginForDevLink(id);
	if (!plugin && options.allowUninstalled) {
		plugin = ephemeralInstalledFromManifest(resolvedDir, manifest);
		ephemeralDevPlugins.set(id, plugin);
	}
	if (!plugin) throw new Error(`Plugin not installed (apply it once before enabling hot reload): ${id}`);
	devLinks.set(id, {
		projectDir: resolvedDir,
		manifest,
		locales: readPluginLocales(resolvedDir, pluginLog),
		reloadToken: Date.now().toString(),
		ephemeral: ephemeralDevPlugins.has(id),
		status: "starting",
	});
	broadcastPluginsChanged({ pluginIds: [id], reload: false, reason: "dev-status" });
	return applyDevOverlay(plugin);
}

export function clearPluginDevLink(id: string): void {
	const changed = devLinks.delete(id) || ephemeralDevPlugins.delete(id);
	if (changed) {
		ephemeralDevPlugins.delete(id);
		broadcastPluginsChanged({ pluginIds: [id], reason: "dev-update" });
	}
}

export function hasPluginDevLink(id: string): boolean {
	return devLinks.has(id);
}

/** 开发服务器报告生命周期变化后，重读 manifest/locales 并定向重载当前插件。 */
export function refreshPluginDevLink(id: string): InstalledPlugin {
	const link = devLinks.get(id);
	if (!link) throw new Error(`Plugin is not dev-linked: ${id}`);
	link.manifest = readDevProjectManifest(link.projectDir, id);
	link.locales = readPluginLocales(link.projectDir, pluginLog);
	link.reloadToken = Date.now().toString();
	link.status = "running";
	link.error = undefined;
	const plugin = getInstalledPluginForDevLink(id);
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	broadcastPluginsChanged({ pluginIds: [id], reason: "dev-update" });
	return applyDevOverlay(plugin);
}

/** Vite 开发服务器就绪后切换 MF 入口；仅允许本机 HTTP origin。 */
export function setPluginDevLinkServer(id: string, entryUrl: string, origin: string): InstalledPlugin {
	const link = devLinks.get(id);
	if (!link) throw new Error(`Plugin is not dev-linked: ${id}`);
	const serverUrls = normalizePluginDevServerUrls(entryUrl, origin);
	link.entryUrl = serverUrls.entryUrl;
	link.origin = serverUrls.origin;
	link.status = "running";
	link.error = undefined;
	link.manifest = readDevProjectManifest(link.projectDir, id);
	link.locales = readPluginLocales(link.projectDir, pluginLog);
	const plugin = getInstalledPluginForDevLink(id);
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	broadcastPluginsChanged({ pluginIds: [id], reason: "dev-ready" });
	return applyDevOverlay(plugin);
}

/** Drop an unavailable server overlay while retaining diagnostics and the stable fallback. */
export function deactivatePluginDevLink(id: string, error: string): InstalledPlugin | undefined {
	const link = devLinks.get(id);
	if (!link) return undefined;
	link.entryUrl = undefined;
	link.origin = undefined;
	link.status = "error";
	link.error = error;
	const plugin = getInstalledPluginForDevLink(id);
	broadcastPluginsChanged({ pluginIds: [id], reason: "dev-update" });
	return plugin ? applyDevOverlay(plugin) : undefined;
}

/** watcher/子进程状态回写（面板经 list() 感知）。链接不存在时静默忽略。 */
export function setPluginDevLinkStatus(id: string, status: PluginDevWatchState["status"], error?: string): void {
	const link = devLinks.get(id);
	if (!link) return;
	link.status = status;
	link.error = error;
	broadcastPluginsChanged({ pluginIds: [id], reload: false, reason: "dev-status" });
}

function resolveInstalledPluginResource(plugin: InstalledPlugin, relativePath: string): string {
	return resolvePluginFilePath(plugin.id, pluginResourceRelativePath(plugin, relativePath));
}

/** 当前全局工作模式（agent_mode 轴，纯全局态）。由 setPluginRuntimeAgentMode 更新，插件级硬闸据此过滤。见 ADR-0046。 */
let currentAgentMode: string | undefined;

/** 主进程记录当前全局工作模式，供 buildAgentPluginRuntimeConfig 的插件级硬闸使用。 */
export function setPluginRuntimeAgentMode(mode: string | undefined): void {
	currentAgentMode = mode;
}

export function readPluginRuntimeAgentMode(): string | undefined {
	return currentAgentMode;
}

export function canInvokeDynamicAgentHook(pluginId: string): boolean {
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	return Boolean(
		plugin?.enabled &&
			isPluginContributionModeActive(pluginId) &&
			pluginMatchesAgentMode(plugin) &&
			hasGrantedPermission(plugin, "agent.hooks.register") &&
			hasGrantedPermission(plugin, "agent.hookHandler.execute"),
	);
}

/**
 * 插件级 agent_mode 硬闸：白名单外整个插件不可见（含 agent 贡献；UI/bundle 由 renderer 端过滤）。
 * 当前无 mode（CLI/headless）或插件未声明 = 放行。见 ADR-0046。
 */
function pluginMatchesAgentMode(plugin: InstalledPlugin): boolean {
	return pluginVisibleInAgentMode(plugin, currentAgentMode);
}

export function buildAgentPluginRuntimeConfig(): AgentPluginRuntimeConfig | undefined {
	const plugins = listPlugins();
	return buildPluginRuntimeConfig({
		plugins,
		agentMode: currentAgentMode,
		isContributionModeActive: isPluginContributionModeActive,
		contributions: pluginAgentContributions,
		resolveResource: resolveInstalledPluginResource,
		resolveMcpRoot: (plugin) =>
			plugin.source === "system" || devLinks.has(plugin.id)
				? resolvePluginFilePath(plugin.id, ".")
				: resolvePluginFilePath(plugin.id, `versions/${encodeURIComponent(plugin.activeVersion)}`),
		logger: pluginLog,
	});
}

export function beginDynamicAgentContributionLoad(pluginId: string, activationId: string): void {
	validatePluginId(pluginId);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	const previous = pluginAgentContributions.beginLoad(pluginId, activationId);
	debugPluginAgent("dynamic agent contribution activation began", {
		pluginId,
		activationId,
		previousToolCount: previous.toolCount,
		previousHookCount: previous.hookCount,
		previousContinuationCount: previous.continuationCount,
	});
}

export function registerDynamicAgentTool(pluginId: string, tool: RegisteredAgentTool): void {
	validatePluginId(pluginId);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (!hasGrantedPermission(plugin, "agent.tools.register")) {
		throw new Error(`Plugin permission denied: agent.tools.register`);
	}
	if (!pluginAgentContributions.registerTool(pluginId, tool)) {
		debugPluginAgent("ignore stale dynamic tool register", {
			pluginId,
			toolId: tool.id,
			toolName: tool.name,
			activationId: tool.activationId,
		});
		return;
	}
	debugPluginAgent("dynamic tool registered", {
		pluginId,
		toolId: tool.id,
		toolName: tool.name,
		handlerId: tool.handlerId,
		activationId: tool.activationId,
		pluginToolCount: pluginAgentContributions.getTools(pluginId).length,
	});
}

export function unregisterDynamicAgentTool(pluginId: string, toolId: string, activationId?: string): void {
	validatePluginId(pluginId);
	if (!pluginAgentContributions.unregisterTool(pluginId, toolId, activationId)) {
		debugPluginAgent("ignore stale dynamic tool unregister", {
			pluginId,
			toolId,
			activationId,
		});
		return;
	}
	debugPluginAgent("dynamic tool unregistered", {
		pluginId,
		toolId,
		remainingPluginToolCount: pluginAgentContributions.getTools(pluginId).length,
	});
}

export function registerDynamicAgentHook(pluginId: string, hook: DesktopPluginHookRegistration): void {
	validatePluginId(pluginId);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (!hasGrantedPermission(plugin, "agent.hooks.register")) {
		throw new Error("Plugin permission denied: agent.hooks.register");
	}
	if (!hasGrantedPermission(plugin, "agent.hookHandler.execute")) {
		throw new Error("Plugin permission denied: agent.hookHandler.execute");
	}
	if (!hook.scope_use?.length) throw new Error("Plugin hook scope_use must not be empty");
	pluginAgentContributions.registerHook(pluginId, hook);
}

export function unregisterDynamicAgentHook(pluginId: string, hookId: string, activationId?: string): void {
	validatePluginId(pluginId);
	pluginAgentContributions.unregisterHook(pluginId, hookId, activationId);
}

export function registerDynamicContinuationProvider(pluginId: string, provider: RegisteredContinuationProvider): void {
	validatePluginId(pluginId);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (!hasGrantedPermission(plugin, "agent.continuation.register")) {
		throw new Error("Plugin permission denied: agent.continuation.register");
	}
	pluginAgentContributions.registerContinuation(pluginId, provider);
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
	if (!pluginAgentContributions.registerSystemPrompt(pluginId, provider)) return;
	pluginLog.debug("[plugin-system-prompt] provider registered", {
		pluginId,
		providerId: provider.id,
		handlerId: provider.handlerId,
		activationId: provider.activationId,
		timeoutMs: provider.timeoutMs,
		providerCount: pluginAgentContributions.getSystemPrompts(pluginId).length,
	});
}

export function unregisterDynamicSystemPromptProvider(
	pluginId: string,
	providerId: string,
	activationId?: string,
): void {
	validatePluginId(pluginId);
	if (!pluginAgentContributions.unregisterSystemPrompt(pluginId, providerId, activationId)) return;
	pluginLog.debug("[plugin-system-prompt] provider unregistered", {
		pluginId,
		providerId,
		activationId,
		remainingProviderCount: pluginAgentContributions.getSystemPrompts(pluginId).length,
	});
}

export function unregisterDynamicContinuationProvider(
	pluginId: string,
	providerId: string,
	activationId?: string,
): void {
	validatePluginId(pluginId);
	pluginAgentContributions.unregisterContinuation(pluginId, providerId, activationId);
}

export function clearDynamicAgentContributions(pluginId: string, activationId?: string): void {
	validatePluginId(pluginId);
	const previous = pluginAgentContributions.clear(pluginId, activationId);
	if (!previous) {
		debugPluginAgent("ignore stale dynamic tools clear", {
			pluginId,
			activationId,
		});
		return;
	}
	debugPluginAgent("dynamic agent contributions cleared", {
		pluginId,
		activationId,
		previousToolCount: previous.toolCount,
		previousHookCount: previous.hookCount,
		previousContinuationCount: previous.continuationCount,
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
		allowedNetworkHosts: manifest.network?.allowedHosts ?? [],
		declaredCommands,
		grantedCommandNames,
		settingsSchema: manifest.contributes?.settings,
		description: manifest.description,
		author: manifest.author,
		iconUrl: resolvePluginIcon(manifest.icon, (path) => toSystemPluginUrl(manifest.id, path, manifest.version)),
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
		const prefs = systemPluginPreferences.read();
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
						readPluginLocales(dir, pluginLog),
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
const pluginSettingsStore = new PluginSettingsStore(pluginSettingsPath, getDesktopCredentialVault());

function getPluginSettingsSchema(pluginId: string): readonly PluginSettingSchema[] {
	return listPlugins().find((plugin) => plugin.id === pluginId)?.settingsSchema ?? [];
}

/** Effective values: schema defaults merged with stored values (stored wins). */
export function getPluginSettings(pluginId: string): Record<string, unknown> {
	validatePluginId(pluginId);
	return pluginSettingsStore.get(pluginId, getPluginSettingsSchema(pluginId));
}

/** Merge values over the stored namespace; returns the new effective values. */
export function setPluginSettings(pluginId: string, values: Record<string, unknown>): Record<string, unknown> {
	validatePluginId(pluginId);
	if (values == null || typeof values !== "object" || Array.isArray(values)) {
		throw new Error("Invalid plugin settings values");
	}
	return pluginSettingsStore.set(pluginId, values, getPluginSettingsSchema(pluginId));
}

export function listPlugins(): InstalledPlugin[] {
	const system = discoverSystemPlugins();
	const reserved = new Set(system.map((plugin) => plugin.id));
	// id 冲突时系统插件遮蔽用户插件（ADR-0024）。
	const registryPlugins = Object.values(pluginRegistry.read());
	const userPlugins = registryPlugins.filter((plugin) => !reserved.has(plugin.id)).map(applyDevOverlay);
	const persistedIds = new Set(registryPlugins.map((plugin) => plugin.id));
	const ephemeralPlugins = Array.from(ephemeralDevPlugins.values())
		.filter((plugin) => !reserved.has(plugin.id) && !persistedIds.has(plugin.id))
		.map(applyDevOverlay);
	return [...system.map(applyDevOverlay), ...userPlugins, ...ephemeralPlugins].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}

export async function installPluginFromArchive(
	archiveBuffer: ArrayBuffer | Buffer,
	options?: PluginInstallOptions,
): Promise<InstalledPlugin> {
	const buffer = Buffer.isBuffer(archiveBuffer) ? archiveBuffer : Buffer.from(archiveBuffer);
	verifySha256(buffer, options?.expectedSha256, "插件安装包");
	const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const extractDir = join(tmpBaseDir, `_install_${stamp}`);
	await extractPluginArchive(buffer, extractDir);
	try {
		const { manifest, sourceDir } = await findPluginManifest(extractDir);
		validatePluginPackageResources(sourceDir, manifest);
		assertPluginInstallIdentity(manifest, options);
		if (isSystemPluginId(manifest.id)) {
			throw new Error(`Cannot install over a system plugin: ${manifest.id}`);
		}
		const registry = pluginRegistry.read();
		const previous = registry[manifest.id];
		await copyPluginPackage(sourceDir, pluginsBaseDir, manifest.id, manifest.version);
		let installed = createInstalledPluginFromManifest({
			manifest,
			options,
			previous,
			locales: readPluginLocales(sourceDir, pluginLog),
			hostApiVersion: PLUGIN_API_VERSION,
			rootPath: computePluginRootPath(
				manifest.id,
				options?.source ?? "archive",
				previous?.activeVersion ?? manifest.version,
			),
		});
		// Fresh install with explicit grants: if caller passed permissions, keep them.
		// ADR-0042 agent path typically grants all declared permissions at approve time.
		if (options?.grantedPermissions && options.grantedPermissions.length > 0) {
			const allowed = new Set(installed.permissions);
			installed = {
				...installed,
				grantedPermissions: options.grantedPermissions.filter((p) => allowed.has(p)),
			};
		}
		if (manifest.contributionMode?.hardIsolation) {
			modeGatedPluginIds.add(manifest.id);
		}
		registry[manifest.id] = installed;
		pluginRegistry.write(registry);
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
	const registry = pluginRegistry.read();
	delete registry[id];
	pluginRegistry.write(registry);
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
		const prefs = systemPluginPreferences.read();
		prefs[id] = { ...prefs[id], enabled };
		systemPluginPreferences.write(prefs);
		const refreshed = discoverSystemPlugins(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		broadcastPluginsChanged();
		return refreshed;
	}
	const registry = pluginRegistry.read();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	plugin.enabled = enabled;
	plugin.updatedAt = new Date().toISOString();
	pluginRegistry.write(registry);
	broadcastPluginsChanged();
	return plugin;
}

export function grantPluginPermissions(id: string, permissions: PluginPermission[]): InstalledPlugin {
	validatePluginId(id);
	if (isSystemPluginId(id)) throw new Error(`System plugin permissions are managed automatically: ${id}`);
	const registry = pluginRegistry.read();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	const allowed = new Set(effectivePluginPermissions(plugin.permissions, plugin.trustLevel));
	plugin.grantedPermissions = Array.from(
		new Set([...plugin.grantedPermissions, ...permissions.filter((p) => allowed.has(p))]),
	);
	plugin.updatedAt = new Date().toISOString();
	pluginRegistry.write(registry);
	broadcastPluginsChanged();
	return plugin;
}

export function revokePluginPermissions(id: string, permissions: PluginPermission[]): InstalledPlugin {
	validatePluginId(id);
	if (isSystemPluginId(id)) throw new Error(`System plugin permissions are managed automatically: ${id}`);
	const registry = pluginRegistry.read();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	const revoked = new Set(permissions);
	plugin.grantedPermissions = plugin.grantedPermissions.filter((permission) => !revoked.has(permission));
	plugin.updatedAt = new Date().toISOString();
	pluginRegistry.write(registry);
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
		const prefs = systemPluginPreferences.read();
		const prev = prefs[id]?.disabledCommands ?? [];
		const next = prev.filter((name) => !requested.includes(name) && declared.has(name));
		prefs[id] = { enabled: prefs[id]?.enabled ?? current.enabled, disabledCommands: next };
		systemPluginPreferences.write(prefs);
		const refreshed = discoverSystemPlugins(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		return refreshed;
	}
	throw new Error(`Plugin command execution is restricted to official plugins: ${id}`);
}

/** Disable declared command names. Inverse of {@link grantPluginCommands}. */
export function revokePluginCommands(id: string, names: string[]): InstalledPlugin {
	validatePluginId(id);
	const requested = parseCommands(names);
	if (isSystemPluginId(id)) {
		const current = discoverSystemPlugins().find((plugin) => plugin.id === id);
		if (!current) throw new Error(`Plugin not found: ${id}`);
		const declared = new Set(current.declaredCommands);
		const prefs = systemPluginPreferences.read();
		const prev = prefs[id]?.disabledCommands ?? [];
		const next = Array.from(new Set([...prev, ...requested.filter((name) => declared.has(name))]));
		prefs[id] = { enabled: prefs[id]?.enabled ?? current.enabled, disabledCommands: next };
		systemPluginPreferences.write(prefs);
		const refreshed = discoverSystemPlugins(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		return refreshed;
	}
	const registry = pluginRegistry.read();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	const revoked = new Set(requested);
	plugin.grantedCommandNames = plugin.grantedCommandNames.filter((name) => !revoked.has(name));
	plugin.updatedAt = new Date().toISOString();
	pluginRegistry.write(registry);
	return plugin;
}

export function reloadPlugin(id: string): InstalledPlugin {
	validatePluginId(id);
	// 系统插件版本随 App，无 pending 更新流（ADR-0024）。
	if (isSystemPluginId(id)) {
		const refreshed = discoverSystemPlugins(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		if (devLinks.has(id)) return refreshPluginDevLink(id);
		broadcastPluginsChanged();
		return refreshed;
	}
	const registry = pluginRegistry.read();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	plugin.activeVersion = plugin.pendingVersion ?? plugin.version;
	plugin.pendingVersion = undefined;
	plugin.availableVersion = undefined;
	const versionDir = join(pluginsBaseDir, plugin.id, "versions", plugin.activeVersion);
	const manifestFile = join(versionDir, "plugin.json");
	const manifest = parseManifest(JSON.parse(readFileSync(manifestFile, "utf-8")));
	plugin.defaultLocale = manifest.defaultLocale ?? "zh";
	plugin.locales = readPluginLocales(versionDir, pluginLog);
	plugin.runtime = manifest.runtime ?? "esm";
	const reloadToken = Date.now().toString();
	plugin.entryUrl = `${toInstalledPluginUrl(plugin.id, plugin.activeVersion, manifest.entry)}&reload=${reloadToken}`;
	plugin.moduleFederation = manifest.moduleFederation;
	plugin.agent = manifest.agent;
	plugin.allowedNetworkHosts = manifest.network?.allowedHosts ?? [];
	plugin.styleUrls = (manifest.styles ?? []).map(
		(style) => `${toInstalledPluginUrl(plugin.id, plugin.activeVersion, style)}&reload=${reloadToken}`,
	);
	// activeVersion 在上面已切到 pendingVersion，图标 URL 必须跟着重算（安装时刻意沿用了旧值）。
	plugin.iconUrl = resolvePluginIcon(
		manifest.icon,
		(path) => `${toInstalledPluginUrl(plugin.id, plugin.activeVersion, path)}&reload=${reloadToken}`,
	);
	// 重载到新版本时同步命令声明，并把用户授权裁剪到新声明集合内（避免授权指向已移除的命令、
	// 或新增命令因 declaredCommands 陈旧而永远无法授权）。
	plugin.permissions = effectivePluginPermissions(manifest.permissions ?? [], plugin.trustLevel);
	plugin.grantedPermissions = effectivePluginPermissions(plugin.grantedPermissions, plugin.trustLevel).filter(
		(permission) => plugin.permissions.includes(permission),
	);
	plugin.declaredCommands = effectivePluginCommands(manifest.commands ?? [], plugin.trustLevel);
	plugin.grantedCommandNames = (plugin.grantedCommandNames ?? []).filter((name) =>
		plugin.declaredCommands.includes(name),
	);
	plugin.rootPath = computePluginRootPath(plugin.id, plugin.source, plugin.activeVersion);
	plugin.updatedAt = new Date().toISOString();
	pluginRegistry.write(registry);
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
