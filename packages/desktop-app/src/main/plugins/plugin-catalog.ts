import { existsSync, readFileSync, rmSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import {
	parsePluginCommandNames as parseCommands,
	parsePluginManifest as parseManifest,
	validatePluginId,
} from "@vetta-org/plugin-sdk/manifest";
import { app, webContents } from "electron";
import type {
	InstalledPlugin,
	PluginInstallOptions,
	PluginPermission,
	PluginSettingSchema,
	PluginsChangedEvent,
} from "../../preload/api-types/plugins.js";
import { PLUGIN_CONTRIBUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { recordAbilityInstall, removeAbilityLedgerEntry } from "../abilities/ability-ledger.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import { verifySha256 } from "../utils/integrity.js";
import { desktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
import { PluginAgentContributionService } from "./plugin-agent-contribution-service.js";
import { PluginDevLinkService } from "./plugin-dev-link-service.js";
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
} from "./plugin-package.js";
import { effectivePluginCommands, effectivePluginPermissions } from "./plugin-permission-policy.js";
import { PluginRegistryStore, SystemPluginPreferenceStore } from "./plugin-registry-store.js";
import { PluginSettingsStore } from "./plugin-settings-store.js";
import { SystemPluginCatalog } from "./plugin-system-catalog.js";

export const PLUGIN_API_VERSION = "1.3.0";
export const CORE_ACTION_PLUGIN_ID = "vetta-actions";

const REQUIRED_SYSTEM_PLUGIN_IDS = new Set<string>([CORE_ACTION_PLUGIN_ID]);
const pluginsBaseDir = join(getVettaHomePath(), "plugins");
const manifestPath = join(getVettaHomePath(), "plugins-manifest.json");
const tmpBaseDir = join(getVettaHomePath(), "tmp", "plugins");
// 系统插件的用户态偏好（目前仅停用开关），与用户插件注册表分离（ADR-0024）。
const systemPrefsPath = join(getVettaHomePath(), "system-plugin-prefs.json");
const pluginRegistry = new PluginRegistryStore(manifestPath, pluginsBaseDir);
const systemPluginPreferences = new SystemPluginPreferenceStore(systemPrefsPath);

const pluginLog = getAppLogger("plugin");
export const pluginAgentContributionService = new PluginAgentContributionService({
	listPlugins,
	isDevLinked: (id) => pluginDevLinkService.has(id),
	resolveFilePath: resolvePluginFilePath,
	logger: pluginLog,
	hooks: desktopPluginHookRegistry,
});
export const pluginSystemCatalog = new SystemPluginCatalog({
	baseDir: systemPluginsBaseDir,
	preferences: systemPluginPreferences,
	requiredPluginIds: REQUIRED_SYSTEM_PLUGIN_IDS,
	hostApiVersion: PLUGIN_API_VERSION,
	isPackaged: app.isPackaged,
	registerModeGate: (id) => pluginAgentContributionService.registerModeGate(id),
	logger: pluginLog,
});
export const pluginDevLinkService = new PluginDevLinkService({
	getBasePlugin: (id) => pluginSystemCatalog.list().find((plugin) => plugin.id === id) ?? pluginRegistry.read()[id],
	broadcast: broadcastPluginsChanged,
	hostApiVersion: PLUGIN_API_VERSION,
	logger: pluginLog,
});

export type { SetPluginDevLinkOptions } from "./plugin-dev-link-service.js";

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
	if (source === "system") return pluginSystemCatalog.rootPath(pluginId);
	return join(pluginsBaseDir, pluginId, "versions", activeVersion);
}

/** 扫描系统插件根目录，合成只读记录并缓存 id 集合（供解析器与冲突门控用）。 */
export function discoverSystemPlugins(force = false): InstalledPlugin[] {
	return pluginSystemCatalog.list(force);
}

export function isSystemPluginId(id: string): boolean {
	return pluginSystemCatalog.has(id);
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
	const userPlugins = registryPlugins
		.filter((plugin) => !reserved.has(plugin.id))
		.map((plugin) => pluginDevLinkService.apply(plugin));
	const persistedIds = new Set(registryPlugins.map((plugin) => plugin.id));
	const ephemeralPlugins = pluginDevLinkService
		.listEphemeral()
		.filter((plugin) => !reserved.has(plugin.id) && !persistedIds.has(plugin.id))
		.map((plugin) => pluginDevLinkService.apply(plugin));
	return [...system.map((plugin) => pluginDevLinkService.apply(plugin)), ...userPlugins, ...ephemeralPlugins].sort(
		(a, b) => a.name.localeCompare(b.name),
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
			pluginAgentContributionService.registerModeGate(manifest.id);
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
	pluginDevLinkService.clear(id, false);
	const registry = pluginRegistry.read();
	delete registry[id];
	pluginRegistry.write(registry);
	removeAbilityLedgerEntry("plugin", id);
	rmSync(join(pluginsBaseDir, id), { recursive: true, force: true });
	broadcastPluginsChanged();
}

export function setPluginEnabled(id: string, enabled: boolean): InstalledPlugin {
	validatePluginId(id);
	// 系统插件可停用但不可删改：偏好写进独立的 prefs 文件，本体不入注册表（ADR-0024）。
	if (isSystemPluginId(id)) {
		const refreshed = pluginSystemCatalog.setEnabled(id, enabled);
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
	if (isSystemPluginId(id)) return pluginSystemCatalog.grantCommands(id, names);
	throw new Error(`Plugin command execution is restricted to official plugins: ${id}`);
}

/** Disable declared command names. Inverse of {@link grantPluginCommands}. */
export function revokePluginCommands(id: string, names: string[]): InstalledPlugin {
	validatePluginId(id);
	const requested = parseCommands(names);
	if (isSystemPluginId(id)) return pluginSystemCatalog.revokeCommands(id, names);
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
		if (pluginDevLinkService.has(id)) return pluginDevLinkService.refresh(id);
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
	if (pluginDevLinkService.has(id)) {
		return pluginDevLinkService.refresh(id);
	}
	broadcastPluginsChanged();
	return plugin;
}

export function resolvePluginFilePath(pluginId: string, relativePath: string): string {
	validatePluginId(pluginId);
	// dev 链接优先：协议请求直接映射到开发工程目录（越界检查同样生效）。
	const devProjectDir = pluginDevLinkService.getProjectDir(pluginId);
	const stableRoot = isSystemPluginId(pluginId)
		? pluginSystemCatalog.rootPath(pluginId)
		: resolve(pluginsBaseDir, pluginId);
	const root = devProjectDir ?? stableRoot;
	const target = resolve(root, relativePath);
	if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
		throw new Error("Plugin file path escapes plugin directory");
	}
	return target;
}
