import { existsSync, readFileSync, rmSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
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
	PluginsChangedEvent,
} from "../../preload/api-types/plugins.js";
import { PLUGIN_CONTRIBUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { recordAbilityInstall, removeAbilityLedgerEntry } from "../abilities/ability-ledger.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import { verifySha256 } from "../utils/integrity.js";
import { DesktopPluginAgentHandlerRegistry } from "./coding-agent-handler-registry.js";
import { desktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
import { PluginAgentContributionService } from "./plugin-agent-contribution-service.js";
import { PLUGIN_API_VERSION } from "./plugin-api-version.js";
import { PluginDevLinkService } from "./plugin-dev-link-service.js";
import { assertPluginInstallIdentity } from "./plugin-install-options.js";
import {
	copyPluginPackage,
	createInstalledPluginFromManifest,
	extractPluginArchive,
	findPluginManifest,
	installedPluginResourceUrl,
	projectPluginVersion,
	readPluginLocales,
	VETTA_PLUGIN_PACKAGE_EXTENSION,
	validatePluginPackageResources,
} from "./plugin-package.js";
import { effectivePluginPermissions, grantDeclaredPluginCommands } from "./plugin-permission-policy.js";
import { PluginRegistryStore, SystemPluginPreferenceStore } from "./plugin-registry-store.js";
import { PluginSecretsStore } from "./plugin-secrets-store.js";
import { SystemPluginCatalog } from "./plugin-system-catalog.js";

export { PLUGIN_API_VERSION } from "./plugin-api-version.js";
export const CORE_ACTION_PLUGIN_ID = "vetta-actions";

const REQUIRED_SYSTEM_PLUGIN_IDS = new Set<string>([CORE_ACTION_PLUGIN_ID]);
const pluginsBaseDir = join(getVettaHomePath(), "plugins");
const manifestPath = join(getVettaHomePath(), "plugins-manifest.json");
const tmpBaseDir = join(getVettaHomePath(), "tmp", "plugins");
const MAX_LOCAL_PLUGIN_PACKAGE_BYTES = 512 * 1024 * 1024;
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
	handlers: new DesktopPluginAgentHandlerRegistry(),
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
/**
 * 主进程内部的插件变更订阅。
 *
 * broadcastPluginsChanged 原本只往渲染进程发 IPC，但主进程自己也有需要跟着重算的东西
 * （如插件贡献的 Agent blueprint）。让它们订阅而不是在这里反向 import，插件目录才不会
 * 被拽着依赖上层业务。
 */
const pluginsChangedListeners = new Set<() => void>();

export function onPluginsChanged(listener: () => void): () => void {
	pluginsChangedListeners.add(listener);
	return () => pluginsChangedListeners.delete(listener);
}

export function broadcastPluginsChanged(event?: PluginsChangedEvent): void {
	for (const listener of pluginsChangedListeners) {
		try {
			listener();
		} catch {
			// 一个订阅者出错不该拦住其余订阅者和渲染进程的广播。
		}
	}
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
// 插件密钥 —— 只走凭据库，普通配置由插件自己用 ctx.storage 持久化（ADR-0105）。
// =============================================================================

const pluginSecretsStore = new PluginSecretsStore(getDesktopCredentialVault());

export function getPluginSecret(pluginId: string, key: string): string | undefined {
	validatePluginId(pluginId);
	return pluginSecretsStore.get(pluginId, key);
}

export function hasPluginSecret(pluginId: string, key: string): boolean {
	validatePluginId(pluginId);
	return pluginSecretsStore.has(pluginId, key);
}

export function listPluginSecretKeys(pluginId: string): string[] {
	validatePluginId(pluginId);
	return pluginSecretsStore.keys(pluginId);
}

export function setPluginSecret(pluginId: string, key: string, value: string): void {
	validatePluginId(pluginId);
	pluginSecretsStore.set(pluginId, key, value);
}

export function deletePluginSecret(pluginId: string, key: string): void {
	validatePluginId(pluginId);
	pluginSecretsStore.delete(pluginId, key);
}

export function clearPluginSecrets(pluginId: string): void {
	validatePluginId(pluginId);
	pluginSecretsStore.clear(pluginId);
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
			rootPath: computePluginRootPath(manifest.id, options?.source ?? "archive", manifest.version),
			reloadToken: Date.now().toString(),
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
		// 能力安装台账（ADR-0049）：记生效中的版本；安装即生效，装完就是新版本。
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

/** Install from a local Vetta package path; legacy .zip remains importable. */
export async function installPluginFromPath(
	filePath: string,
	options?: PluginInstallOptions,
): Promise<InstalledPlugin> {
	const buffer = await readPluginPackageFromPath(filePath);
	return installPluginFromArchive(buffer, { ...options, source: options?.source ?? "archive" });
}

export async function readPluginPackageFromPath(filePath: string): Promise<Buffer> {
	if (typeof filePath !== "string" || filePath.trim().length === 0) {
		throw new Error("Plugin path is required");
	}
	const resolved = isAbsolute(filePath) ? filePath : resolve(filePath);
	if (!existsSync(resolved)) {
		throw new Error(`Plugin archive not found: ${resolved}`);
	}
	const lowerPath = resolved.toLowerCase();
	if (!lowerPath.endsWith(VETTA_PLUGIN_PACKAGE_EXTENSION) && !lowerPath.endsWith(".zip")) {
		throw new Error(`Plugin path must be a ${VETTA_PLUGIN_PACKAGE_EXTENSION} package or legacy .zip archive`);
	}
	const info = await stat(resolved);
	if (!info.isFile() || info.size > MAX_LOCAL_PLUGIN_PACKAGE_BYTES) {
		throw new Error("Plugin package is not a regular file or exceeds the 512 MB limit");
	}
	return readFile(resolved);
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
	const allowed = new Set(effectivePluginPermissions(plugin.permissions));
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
	const requested = parseCommands(names);
	const registry = pluginRegistry.read();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	plugin.grantedCommandNames = grantDeclaredPluginCommands(
		plugin.grantedCommandNames,
		requested,
		plugin.declaredCommands,
	);
	plugin.updatedAt = new Date().toISOString();
	pluginRegistry.write(registry);
	broadcastPluginsChanged();
	return plugin;
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
	broadcastPluginsChanged();
	return plugin;
}

/** 一次写入首装配置，避免权限/命令/启用各自产生重载与变更广播。 */
export function applyPluginSetup(
	id: string,
	input: { enabled: boolean; grantedPermissions: PluginPermission[]; grantedCommands: string[] },
): InstalledPlugin {
	validatePluginId(id);
	if (isSystemPluginId(id)) throw new Error(`System plugin setup is managed automatically: ${id}`);
	const registry = pluginRegistry.read();
	const plugin = registry[id];
	if (!plugin) throw new Error(`Plugin not found: ${id}`);
	const allowedPermissions = new Set(effectivePluginPermissions(plugin.permissions));
	plugin.grantedPermissions = Array.from(
		new Set(input.grantedPermissions.filter((permission) => allowedPermissions.has(permission))),
	);
	plugin.grantedCommandNames = grantDeclaredPluginCommands(
		[],
		parseCommands(input.grantedCommands),
		plugin.declaredCommands,
	);
	plugin.enabled = input.enabled;
	plugin.updatedAt = new Date().toISOString();
	pluginRegistry.write(registry);
	broadcastPluginsChanged();
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
	// pendingVersion 是旧版本宿主留下的「装了但没生效」状态；安装已经不再产生它，这里顺手收敛。
	plugin.activeVersion = plugin.pendingVersion ?? plugin.version;
	plugin.pendingVersion = undefined;
	plugin.availableVersion = undefined;
	const versionDir = join(pluginsBaseDir, plugin.id, "versions", plugin.activeVersion);
	const manifestFile = join(versionDir, "plugin.json");
	const manifest = parseManifest(JSON.parse(readFileSync(manifestFile, "utf-8")));
	const reloadToken = Date.now().toString();
	Object.assign(
		plugin,
		projectPluginVersion({
			manifest,
			locales: readPluginLocales(versionDir, pluginLog),
			toResourceUrl: (path) => installedPluginResourceUrl(plugin.id, plugin.activeVersion, path, reloadToken),
		}),
	);
	// 授权集合裁剪到新声明内（避免授权指向已移除的命令、或新增命令因 declaredCommands 陈旧而永远无法授权）。
	plugin.grantedPermissions = effectivePluginPermissions(plugin.grantedPermissions).filter((permission) =>
		plugin.permissions.includes(permission),
	);
	plugin.grantedCommandNames = (plugin.grantedCommandNames ?? []).filter((name) =>
		plugin.declaredCommands.includes(name),
	);
	plugin.rootPath = computePluginRootPath(plugin.id, plugin.source, plugin.activeVersion);
	plugin.updatedAt = new Date().toISOString();
	pluginRegistry.write(registry);
	// 台账（ADR-0049）跟着改写为实际生效的版本。
	recordAbilityInstall("plugin", plugin.id, plugin.activeVersion);
	// dev 链接期间：注册表照常收敛到实际版本（否则「应用到 Vetta」的新版本会被吞掉，
	// 关热更新后回落旧版本），但返回值与广播叠加 dev 快照（资源仍从工程加载）。
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
