import { ipcMain, webContents } from "electron";
import type { AppMonitorResourceOperation, AppMonitorResourceSource } from "../../preload/api-types/app-monitor.js";
import type {
	InstalledPlugin,
	PluginAppActionApproval,
	PluginAppActionRegistration,
	PluginCommandRunOptions,
	PluginInstallOptions,
	PluginOffscreenCaptureOptions,
	PluginPermission,
} from "../../preload/api-types/plugins.js";
import { PLUGIN_SYSTEM_CHANNELS } from "../../shared/plugin-capability-ipc.js";
import { recordAppMonitorEvent } from "../app-monitor/app-monitor-service.js";
import { getDesktopCapabilityHost } from "../capabilities/capability-host.js";
import { getAppLogger } from "../logger.js";
import { runPluginCommand } from "../plugins/command-runner.js";
import {
	getPluginCommandSpawnStatus,
	type SpawnPluginCommandOptions,
	spawnPluginCommand,
	stopAllPluginSpawns,
	stopAllSpawnsForPlugin,
	stopPluginCommandSpawn,
} from "../plugins/command-spawner.js";
import {
	capturePluginOffscreen,
	destroyAllOffscreenSessions,
	destroyOffscreenSessionsForPlugin,
	releasePluginOffscreenSession,
} from "../plugins/offscreen-capture-service.js";
import type { PluginActionService } from "../plugins/plugin-action-service.js";
import { startPluginDevWatch, stopPluginDevWatch } from "../plugins/plugin-dev-watch.js";
import {
	beginDynamicAgentContributionLoad,
	buildAgentPluginRuntimeConfig,
	clearDynamicAgentContributions,
	getPluginSettings,
	grantPluginCommands,
	grantPluginPermissions,
	installPluginFromArchive,
	installPluginFromPath,
	installPluginFromUrl,
	listPlugins,
	pluginVisibleInAgentMode,
	registerDynamicAgentTool,
	registerDynamicContinuationProvider,
	registerDynamicSystemPromptProvider,
	registerPluginModeGate,
	reloadPlugin,
	revokePluginCommands,
	revokePluginPermissions,
	setPluginContributionMode,
	setPluginEnabled,
	setPluginSettings,
	summarizeAgentPluginRuntimeConfig,
	uninstallPlugin,
	unregisterDynamicAgentTool,
	unregisterDynamicContinuationProvider,
	unregisterDynamicSystemPromptProvider,
} from "../plugins/plugin-store.js";
import { getSharedRuntime } from "../runtime.js";
import { readDesktopConfig } from "./fs.js";

function asArchiveBuffer(value: unknown): ArrayBuffer | Buffer {
	if (value instanceof ArrayBuffer || Buffer.isBuffer(value)) return value;
	throw new Error("Invalid plugin archive buffer");
}

function asOptions(value: unknown): PluginInstallOptions | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object") throw new Error("Invalid plugin install options");
	const input = value as Record<string, unknown>;
	const source = input.source === "remote" ? "remote" : input.source === "archive" ? "archive" : undefined;
	const grantedPermissions =
		Array.isArray(input.grantedPermissions) && input.grantedPermissions.every((item) => typeof item === "string")
			? (input.grantedPermissions as PluginPermission[])
			: undefined;
	const enable = input.enable === true ? true : input.enable === false ? false : undefined;
	const expectedSha256 = typeof input.expectedSha256 === "string" ? input.expectedSha256 : undefined;
	return { source, grantedPermissions, enable, expectedSha256 };
}

function asPluginId(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("Invalid plugin id");
	}
	return value.trim();
}

function asOptionalStringId(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid ${fieldName}`);
	}
	return value.trim();
}

function asPermissions(value: unknown): PluginPermission[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error("Invalid plugin permissions");
	}
	return value as PluginPermission[];
}

function asCommandNames(value: unknown): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
		throw new Error("Invalid plugin command names");
	}
	return value as string[];
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Invalid ${fieldName}`);
	}
	return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
	if (value == null) return undefined;
	if (!Array.isArray(value)) return undefined;
	const out = value.filter((v): v is string => typeof v === "string" && v.length > 0);
	return out.length > 0 ? out : [];
}

function asHandlerContext(value: unknown): { conversation?: "summary" | "messages" } | undefined {
	if (value === undefined) return undefined;
	const input = asRecord(value, "handler context");
	return { conversation: input.conversation === "messages" ? "messages" : "summary" };
}

function asAgentToolRegistration(value: unknown): {
	id: string;
	name: string;
	label?: string;
	description: string;
	parameters: Record<string, unknown>;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	scope_use?: string[];
	requires?: string[];
	agent_mode?: string[];
	context?: { conversation?: "summary" | "messages" };
	rendersCard?: boolean;
} {
	const input = asRecord(value, "agent tool registration");
	const id = asPluginId(input.id);
	const name = asPluginId(input.name ?? id);
	const description = asOptionalString(input.description);
	const handlerId = asPluginId(input.handlerId);
	const activationId = asOptionalStringId(input.activationId, "agent tool activation id");
	if (!description) throw new Error("Invalid agent tool description");
	const parameters = asRecord(input.parameters, "agent tool parameters");
	const timeoutMs =
		typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
			? Math.min(Math.floor(input.timeoutMs), 300_000)
			: undefined;
	return {
		id,
		name,
		label: asOptionalString(input.label),
		description,
		parameters,
		handlerId,
		activationId,
		timeoutMs,
		scope_use: asOptionalStringArray(input.scope_use),
		requires: asOptionalStringArray(input.requires),
		agent_mode: asOptionalStringArray(input.agent_mode),
		context: asHandlerContext(input.context),
		// 渲染进程在注册时探测该工具有没有 tool-call slot；有则宿主注入 md_intro 参数。
		rendersCard: input.rendersCard === true ? true : undefined,
	};
}

function asAppActionApproval(value: unknown): PluginAppActionApproval | undefined {
	if (value === undefined) return undefined;
	const input = asRecord(value, "app action approval");
	const defaultPresentation = asOptionalString(input.defaultPresentation);
	if (!defaultPresentation || !Array.isArray(input.presentations)) {
		throw new Error("Invalid app action approval metadata");
	}
	const presentations = input.presentations.map((value) => {
		const presentation = asRecord(value, "app action approval presentation");
		const id = asOptionalString(presentation.id);
		const title = asOptionalString(presentation.title);
		const description = asOptionalString(presentation.description);
		if (!id || !title || !description) throw new Error("Invalid app action approval presentation");
		return { id, title, description };
	});
	const operationInput =
		input.presentationByOperation === undefined
			? undefined
			: asRecord(input.presentationByOperation, "app action approval operation map");
	const presentationByOperation = operationInput
		? Object.fromEntries(
				Object.entries(operationInput).map(([operation, presentation]) => {
					if (typeof presentation !== "string" || presentation.trim().length === 0) {
						throw new Error("Invalid app action approval operation presentation");
					}
					return [operation, presentation.trim()];
				}),
			)
		: undefined;
	const alternativesInput =
		input.alternativePresentationsByOperation === undefined
			? undefined
			: asRecord(input.alternativePresentationsByOperation, "app action approval alternative map");
	const alternativePresentationsByOperation = alternativesInput
		? Object.fromEntries(
				Object.entries(alternativesInput).map(([operation, alternatives]) => {
					if (
						!Array.isArray(alternatives) ||
						alternatives.some((presentation) => typeof presentation !== "string" || !presentation.trim())
					) {
						throw new Error("Invalid app action alternative approval presentations");
					}
					return [operation, alternatives.map((presentation) => presentation.trim())];
				}),
			)
		: undefined;
	return {
		defaultPresentation,
		presentations,
		presentationByOperation,
		alternativePresentationsByOperation,
	};
}

function asAppActionRegistration(value: unknown): PluginAppActionRegistration {
	const input = asRecord(value, "app action registration");
	const id = asPluginId(input.id);
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
		throw new Error("Invalid app action id");
	}
	const title = asOptionalString(input.title);
	const summary = asOptionalString(input.summary);
	const publicId = asOptionalString(input.publicId);
	if (publicId && !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(publicId)) {
		throw new Error("Invalid app action public id");
	}
	const handlerId = asPluginId(input.handlerId);
	const activationId = asPluginId(input.activationId);
	if (!title) throw new Error("Invalid app action title");
	if (!summary) throw new Error("Invalid app action summary");
	if (input.effect !== "read" && input.effect !== "write" && input.effect !== "execute") {
		throw new Error("Invalid app action effect");
	}
	const examples = input.examples === undefined ? [] : input.examples;
	if (!Array.isArray(examples)) throw new Error("Invalid app action examples");
	return {
		id,
		publicId,
		title,
		summary,
		description: asOptionalString(input.description),
		keywords: asOptionalStringArray(input.keywords),
		effect: input.effect,
		approval: asAppActionApproval(input.approval),
		inputSchema: asRecord(input.inputSchema, "app action input schema"),
		examples: examples.map((example) => {
			const normalized = asRecord(example, "app action example");
			const description = asOptionalString(normalized.description);
			if (!description) throw new Error("Invalid app action example description");
			return { description, input: normalized.input };
		}),
		handlerId,
		activationId,
		hasAssertReady: input.hasAssertReady === true,
		timeoutMs:
			typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
				? Math.min(Math.floor(input.timeoutMs), 120_000)
				: undefined,
	};
}

function asContinuationRegistration(value: unknown): {
	id: string;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	context?: { conversation?: "summary" | "messages" };
} {
	const input = asRecord(value, "continuation registration");
	return {
		id: asPluginId(input.id),
		handlerId: asPluginId(input.handlerId),
		activationId: asOptionalStringId(input.activationId, "continuation activation id"),
		timeoutMs:
			typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
				? Math.min(Math.floor(input.timeoutMs), 30_000)
				: undefined,
		context: asHandlerContext(input.context),
	};
}

function asSystemPromptProviderRegistration(value: unknown): {
	id: string;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	context?: {
		systemPrompt?: "none" | "blocks" | "rendered" | "full";
		conversation?: "summary" | "messages";
	};
} {
	const input = asRecord(value, "system prompt provider registration");
	const contextInput =
		input.context === undefined ? undefined : asRecord(input.context, "system prompt provider context");
	const systemPrompt =
		contextInput?.systemPrompt === "blocks" ||
		contextInput?.systemPrompt === "rendered" ||
		contextInput?.systemPrompt === "full"
			? contextInput.systemPrompt
			: "none";
	const conversation = contextInput?.conversation === "messages" ? "messages" : "summary";
	return {
		id: asPluginId(input.id),
		handlerId: asPluginId(input.handlerId),
		activationId: asOptionalStringId(input.activationId, "system prompt provider activation id"),
		timeoutMs:
			typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
				? Math.min(Math.floor(input.timeoutMs), 30_000)
				: undefined,
		context: contextInput ? { systemPrompt, conversation } : undefined,
	};
}

const pluginLog = getAppLogger("plugin");

function refreshAgentPlugins(): void {
	const config = buildAgentPluginRuntimeConfig();
	pluginLog.debug("refresh agent plugins", summarizeAgentPluginRuntimeConfig(config));
	getSharedRuntime().reconfigureAgentPlugins(config);
}

function recordPluginResourceEvent(input: {
	plugin: Pick<InstalledPlugin, "id" | "source">;
	operation: AppMonitorResourceOperation;
	permissionCount?: number;
	commandCount?: number;
}): void {
	try {
		recordAppMonitorEvent({
			type: "resource.lifecycle",
			resourceKind: "plugin",
			operation: input.operation,
			resourceId: input.plugin.id,
			source: toAppMonitorPluginSource(input.plugin.source),
			system: input.plugin.source === "system",
			...(input.permissionCount === undefined ? {} : { permissionCount: input.permissionCount }),
			...(input.commandCount === undefined ? {} : { commandCount: input.commandCount }),
		});
	} catch {
		// Monitoring must not affect plugin operations.
	}
}

function toAppMonitorPluginSource(source: InstalledPlugin["source"]): AppMonitorResourceSource {
	if (source === "system") return "system";
	if (source === "remote") return "remote";
	return "archive";
}

function isFreshPluginInstall(plugin: Pick<InstalledPlugin, "installedAt" | "updatedAt">): boolean {
	return plugin.installedAt === plugin.updatedAt;
}

function countAdded(previous: readonly string[], next: readonly string[]): number {
	const before = new Set(previous);
	return next.filter((item) => !before.has(item)).length;
}

function countRemoved(previous: readonly string[], next: readonly string[]): number {
	const after = new Set(next);
	return previous.filter((item) => !after.has(item)).length;
}

async function listVisiblePlugins(): Promise<InstalledPlugin[]> {
	const mode = (await readDesktopConfig()).agentMode ?? "work";
	return listPlugins().filter((plugin) => pluginVisibleInAgentMode(plugin, mode));
}

async function installFromUrl(url: unknown, options: unknown): Promise<InstalledPlugin> {
	if (typeof url !== "string" || url.trim().length === 0) {
		throw new Error("Invalid plugin URL");
	}
	const plugin = await installPluginFromUrl(url.trim(), asOptions(options));
	recordPluginResourceEvent({
		plugin,
		operation: isFreshPluginInstall(plugin) ? "installed" : "updated",
	});
	refreshAgentPlugins();
	return plugin;
}

async function installFromPath(path: unknown, options: unknown): Promise<InstalledPlugin> {
	if (typeof path !== "string" || path.trim().length === 0) {
		throw new Error("Invalid plugin path");
	}
	const plugin = await installPluginFromPath(path.trim(), asOptions(options));
	recordPluginResourceEvent({
		plugin,
		operation: isFreshPluginInstall(plugin) ? "installed" : "updated",
	});
	refreshAgentPlugins();
	return plugin;
}

function uninstallInstalledPlugin(pluginActionService: PluginActionService, id: unknown): void {
	const pluginId = asPluginId(id);
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	// 卸载前停掉 dev 热更新（vite watch 子进程 + dist 监听）与长驻 spawn 进程。
	stopPluginDevWatch(pluginId);
	stopAllSpawnsForPlugin(pluginId);
	destroyOffscreenSessionsForPlugin(pluginId);
	uninstallPlugin(pluginId);
	pluginActionService.clear(pluginId);
	refreshAgentPlugins();
	if (plugin) recordPluginResourceEvent({ plugin, operation: "uninstalled" });
}

function setInstalledPluginEnabled(
	pluginActionService: PluginActionService,
	id: unknown,
	enabled: unknown,
): InstalledPlugin {
	const pluginId = asPluginId(id);
	// 禁用即停 dev 热更新：否则被禁用的插件仍常驻 vite watch，且每次保存都触发全表重载。
	// 长驻 spawn 同理：禁用的插件不得留后台进程。
	if (enabled !== true) {
		stopPluginDevWatch(pluginId);
		stopAllSpawnsForPlugin(pluginId);
		destroyOffscreenSessionsForPlugin(pluginId);
	}
	const plugin = setPluginEnabled(pluginId, enabled === true);
	if (!plugin.enabled) pluginActionService.clear(pluginId);
	refreshAgentPlugins();
	recordPluginResourceEvent({ plugin, operation: plugin.enabled ? "enabled" : "disabled" });
	return plugin;
}

function grantInstalledPluginPermissions(id: unknown, permissions: unknown): InstalledPlugin {
	const pluginId = asPluginId(id);
	const previous = listPlugins().find((candidate) => candidate.id === pluginId)?.grantedPermissions ?? [];
	const plugin = grantPluginPermissions(pluginId, asPermissions(permissions));
	refreshAgentPlugins();
	recordPluginResourceEvent({
		plugin,
		operation: "permissions-granted",
		permissionCount: countAdded(previous, plugin.grantedPermissions),
	});
	return plugin;
}

function reloadInstalledPlugin(id: unknown): InstalledPlugin {
	// reload 后 renderer 会重新 activate；旧激活的长驻进程一并回收，避免孤儿 server。
	stopAllSpawnsForPlugin(asPluginId(id));
	destroyOffscreenSessionsForPlugin(asPluginId(id));
	const plugin = reloadPlugin(asPluginId(id));
	refreshAgentPlugins();
	recordPluginResourceEvent({ plugin, operation: "reloaded" });
	return plugin;
}

async function installOfficialPluginFromPath(
	pluginActionService: PluginActionService,
	path: unknown,
	options: unknown,
): Promise<InstalledPlugin> {
	const normalized = asOptions(options);
	const enable = normalized?.enable !== false;
	let plugin = await installFromPath(path, {
		source: "archive",
		grantedPermissions: normalized?.grantedPermissions,
		enable,
	});
	if (
		(!normalized?.grantedPermissions || normalized.grantedPermissions.length === 0) &&
		plugin.permissions.length > 0
	) {
		plugin = grantInstalledPluginPermissions(plugin.id, plugin.permissions);
	}
	return setInstalledPluginEnabled(pluginActionService, plugin.id, enable);
}

export function registerPluginsIpc(pluginActionService: PluginActionService): () => void {
	const capabilityAdapter = getDesktopCapabilityHost().adapters.plugin;
	// 插件级 agent_mode 硬闸的 renderer 侧：白名单外的插件对渲染层完全不可见
	// （工作台列表 + UI 贡献 + bundle 均不出现）。见 ADR-0046。
	ipcMain.handle("vetta:plugins:list", () => listVisiblePlugins());
	// 能力市场（我的）需要完整清单：按工作模式过滤会让另一模式下已装的插件凭空消失，
	// 用户会误以为能力已丢失。此处不过滤，模式差异由详情页的工作场景标注说明。
	ipcMain.handle("vetta:plugins:list-all", () => listPlugins());
	ipcMain.handle("vetta:plugins:install-from-archive", async (_event, archiveBuffer: unknown, options: unknown) => {
		const plugin = await installPluginFromArchive(asArchiveBuffer(archiveBuffer), asOptions(options));
		recordPluginResourceEvent({
			plugin,
			operation: isFreshPluginInstall(plugin) ? "installed" : "updated",
		});
		return plugin;
	});
	ipcMain.handle("vetta:plugins:install-from-url", (_event, url: unknown, options: unknown) =>
		installFromUrl(url, options),
	);
	ipcMain.handle("vetta:plugins:install-from-path", (_event, path: unknown, options: unknown) =>
		installFromPath(path, options),
	);
	ipcMain.handle("vetta:plugins:register-mode-gate", (_event, id: unknown) => {
		registerPluginModeGate(asPluginId(id));
		refreshAgentPlugins();
	});
	ipcMain.handle("vetta:plugins:set-contribution-mode", (_event, id: unknown, active: unknown) => {
		setPluginContributionMode(asPluginId(id), active === true);
		refreshAgentPlugins();
	});
	ipcMain.handle("vetta:plugins:uninstall", (_event, id: unknown) =>
		uninstallInstalledPlugin(pluginActionService, id),
	);
	ipcMain.handle("vetta:plugins:set-enabled", (_event, id: unknown, enabled: unknown) =>
		setInstalledPluginEnabled(pluginActionService, id, enabled),
	);
	ipcMain.handle("vetta:plugins:grant-permissions", (_event, id: unknown, permissions: unknown) =>
		grantInstalledPluginPermissions(id, permissions),
	);
	ipcMain.handle("vetta:plugins:revoke-permissions", (_event, id: unknown, permissions: unknown) => {
		const pluginId = asPluginId(id);
		const previous = listPlugins().find((candidate) => candidate.id === pluginId)?.grantedPermissions ?? [];
		const plugin = revokePluginPermissions(pluginId, asPermissions(permissions));
		if (
			!plugin.grantedPermissions.includes("app.actions.register") ||
			!plugin.grantedPermissions.includes("app.actionHandler.execute")
		) {
			pluginActionService.clear(pluginId);
		}
		refreshAgentPlugins();
		recordPluginResourceEvent({
			plugin,
			operation: "permissions-revoked",
			permissionCount: countRemoved(previous, plugin.grantedPermissions),
		});
		return plugin;
	});
	ipcMain.handle("vetta:plugins:grant-commands", (_event, id: unknown, names: unknown) => {
		const pluginId = asPluginId(id);
		const previous = listPlugins().find((candidate) => candidate.id === pluginId)?.grantedCommandNames ?? [];
		const plugin = grantPluginCommands(pluginId, asCommandNames(names));
		recordPluginResourceEvent({
			plugin,
			operation: "commands-granted",
			commandCount: countAdded(previous, plugin.grantedCommandNames),
		});
		return plugin;
	});
	ipcMain.handle("vetta:plugins:revoke-commands", (_event, id: unknown, names: unknown) => {
		const pluginId = asPluginId(id);
		const previous = listPlugins().find((candidate) => candidate.id === pluginId)?.grantedCommandNames ?? [];
		const plugin = revokePluginCommands(pluginId, asCommandNames(names));
		recordPluginResourceEvent({
			plugin,
			operation: "commands-revoked",
			commandCount: countRemoved(previous, plugin.grantedCommandNames),
		});
		return plugin;
	});
	ipcMain.handle(
		"vetta:plugins:command-run",
		(_event, sessionId: unknown, file: unknown, args: unknown, options: unknown) =>
			runPluginCommand(
				capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
				typeof file === "string" ? file : "",
				args,
				(options ?? undefined) as PluginCommandRunOptions | undefined,
			),
	);
	ipcMain.handle(
		"vetta:plugins:command-spawn",
		(_event, sessionId: unknown, file: unknown, args: unknown, options: unknown) =>
			spawnPluginCommand(
				capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
				typeof file === "string" ? file : "",
				args,
				(options ?? undefined) as SpawnPluginCommandOptions | undefined,
			),
	);
	ipcMain.handle("vetta:plugins:command-spawn-stop", (_event, sessionId: unknown, spawnId: unknown) =>
		stopPluginCommandSpawn(capabilityAdapter.pluginIdForSession(asPluginId(sessionId)), asPluginId(spawnId)),
	);
	ipcMain.handle("vetta:plugins:command-spawn-status", (_event, sessionId: unknown, spawnId: unknown) =>
		getPluginCommandSpawnStatus(capabilityAdapter.pluginIdForSession(asPluginId(sessionId)), asPluginId(spawnId)),
	);
	ipcMain.handle("vetta:plugins:offscreen-capture", (_event, pluginId: unknown, options: unknown) =>
		capturePluginOffscreen(asPluginId(pluginId), (options ?? undefined) as PluginOffscreenCaptureOptions | undefined),
	);
	ipcMain.handle("vetta:plugins:offscreen-release", (_event, pluginId: unknown, sessionKey: unknown) =>
		releasePluginOffscreenSession(asPluginId(pluginId), typeof sessionKey === "string" ? sessionKey : ""),
	);
	ipcMain.handle("vetta:plugins:reload", (_event, id: unknown) => reloadInstalledPlugin(id));
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.LIST, (_event, sessionId: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return listVisiblePlugins();
	});
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.INSTALL_FROM_URL, (_event, sessionId: unknown, url: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return installFromUrl(url, undefined);
	});
	ipcMain.handle(
		PLUGIN_SYSTEM_CHANNELS.INSTALL_FROM_PATH,
		(_event, sessionId: unknown, path: unknown, options: unknown) => {
			capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
			return installOfficialPluginFromPath(pluginActionService, path, options);
		},
	);
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.UNINSTALL, (_event, sessionId: unknown, id: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return uninstallInstalledPlugin(pluginActionService, id);
	});
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.SET_ENABLED, (_event, sessionId: unknown, id: unknown, enabled: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return setInstalledPluginEnabled(pluginActionService, id, enabled);
	});
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.RELOAD, (_event, sessionId: unknown, id: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return reloadInstalledPlugin(id);
	});
	ipcMain.handle("vetta:plugins:dev-watch-start", (_event, sessionId: unknown, id: unknown, projectDir: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		const pluginId = asPluginId(id);
		if (typeof projectDir !== "string" || projectDir.trim().length === 0) {
			throw new Error("Invalid plugin project dir");
		}
		const plugin = startPluginDevWatch(pluginId, projectDir.trim());
		refreshAgentPlugins();
		return plugin;
	});
	ipcMain.handle("vetta:plugins:dev-watch-stop", (_event, sessionId: unknown, id: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		stopPluginDevWatch(asPluginId(id));
		refreshAgentPlugins();
	});
	ipcMain.handle(
		"vetta:plugins:agent-contributions-begin-load",
		(_event, pluginId: unknown, activationId: unknown) => {
			const normalizedPluginId = asPluginId(pluginId);
			const normalizedActivationId = asPluginId(activationId);
			pluginLog.debug("ipc agent-tools-begin-load", {
				pluginId: normalizedPluginId,
				activationId: normalizedActivationId,
			});
			beginDynamicAgentContributionLoad(normalizedPluginId, normalizedActivationId);
			pluginActionService.beginLoad(normalizedPluginId, normalizedActivationId);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle("vetta:plugins:app-action-register", (_event, pluginId: unknown, registration: unknown) => {
		pluginActionService.register(asPluginId(pluginId), asAppActionRegistration(registration));
	});
	ipcMain.handle("vetta:plugins:app-action-activation-commit", (_event, pluginId: unknown, activationId: unknown) => {
		pluginActionService.commit(asPluginId(pluginId), asPluginId(activationId));
	});
	ipcMain.handle("vetta:plugins:app-action-activation-abort", (_event, pluginId: unknown, activationId: unknown) => {
		pluginActionService.abort(asPluginId(pluginId), asPluginId(activationId));
	});
	ipcMain.handle(
		"vetta:plugins:app-action-unregister",
		(_event, pluginId: unknown, actionId: unknown, activationId: unknown) => {
			pluginActionService.unregister(
				asPluginId(pluginId),
				asPluginId(actionId),
				asOptionalStringId(activationId, "app action activation id"),
			);
		},
	);
	ipcMain.handle("vetta:plugins:app-action-response", (_event, requestId: unknown, result: unknown) => {
		pluginActionService.respond(asPluginId(requestId), result);
	});
	ipcMain.handle("vetta:plugins:continuation-register", (_event, pluginId: unknown, registration: unknown) => {
		registerDynamicContinuationProvider(asPluginId(pluginId), asContinuationRegistration(registration));
		refreshAgentPlugins();
	});
	ipcMain.handle(
		"vetta:plugins:system-prompt-provider-register",
		(_event, pluginId: unknown, registration: unknown) => {
			registerDynamicSystemPromptProvider(asPluginId(pluginId), asSystemPromptProviderRegistration(registration));
			refreshAgentPlugins();
		},
	);
	ipcMain.handle(
		"vetta:plugins:system-prompt-provider-unregister",
		(_event, pluginId: unknown, providerId: unknown, activationId: unknown) => {
			unregisterDynamicSystemPromptProvider(
				asPluginId(pluginId),
				asPluginId(providerId),
				asOptionalStringId(activationId, "system prompt provider activation id"),
			);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle(
		"vetta:plugins:continuation-unregister",
		(_event, pluginId: unknown, providerId: unknown, activationId: unknown) => {
			unregisterDynamicContinuationProvider(
				asPluginId(pluginId),
				asPluginId(providerId),
				asOptionalStringId(activationId, "continuation activation id"),
			);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle("vetta:plugins:agent-tool-register", (_event, pluginId: unknown, registration: unknown) => {
		const normalizedPluginId = asPluginId(pluginId);
		const normalizedRegistration = asAgentToolRegistration(registration);
		pluginLog.debug("ipc agent-tool-register", {
			pluginId: normalizedPluginId,
			toolId: normalizedRegistration.id,
			toolName: normalizedRegistration.name,
			handlerId: normalizedRegistration.handlerId,
			activationId: normalizedRegistration.activationId,
		});
		registerDynamicAgentTool(normalizedPluginId, normalizedRegistration);
		refreshAgentPlugins();
	});
	ipcMain.handle(
		"vetta:plugins:agent-tool-unregister",
		(_event, pluginId: unknown, toolId: unknown, activationId: unknown) => {
			const normalizedPluginId = asPluginId(pluginId);
			const normalizedToolId = asPluginId(toolId);
			const normalizedActivationId = asOptionalStringId(activationId, "agent tool activation id");
			pluginLog.debug("ipc agent-tool-unregister", {
				pluginId: normalizedPluginId,
				toolId: normalizedToolId,
				activationId: normalizedActivationId,
			});
			unregisterDynamicAgentTool(normalizedPluginId, normalizedToolId, normalizedActivationId);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle("vetta:plugins:agent-contributions-clear", (_event, pluginId: unknown, activationId: unknown) => {
		const normalizedPluginId = asPluginId(pluginId);
		const normalizedActivationId = asOptionalStringId(activationId, "agent tool activation id");
		pluginLog.debug("ipc agent-tools-clear", {
			pluginId: normalizedPluginId,
			activationId: normalizedActivationId,
		});
		clearDynamicAgentContributions(normalizedPluginId, normalizedActivationId);
		pluginActionService.clear(normalizedPluginId, normalizedActivationId);
		refreshAgentPlugins();
	});
	ipcMain.handle("vetta:plugins:get-settings", (_event, id: unknown) => getPluginSettings(asPluginId(id)));
	ipcMain.handle("vetta:plugins:set-settings", (_event, id: unknown, values: unknown) => {
		const pluginId = asPluginId(id);
		if (values == null || typeof values !== "object" || Array.isArray(values)) {
			throw new Error("Invalid plugin settings values");
		}
		const effective = setPluginSettings(pluginId, values as Record<string, unknown>);
		refreshAgentPlugins();
		// Broadcast so the plugin host (and any open settings view) can react live.
		for (const contents of webContents.getAllWebContents()) {
			contents.send("vetta:plugins:settings-changed", { pluginId, values: effective });
		}
	});
	ipcMain.handle("vetta:plugins:network:request", (_event, sessionId: unknown, request: unknown) => {
		return capabilityAdapter.requestNetwork(asPluginId(sessionId), request);
	});
	ipcMain.handle("vetta:plugins:gateway:request", (_event, sessionId: unknown, request: unknown) => {
		return capabilityAdapter.requestGateway(asPluginId(sessionId), request);
	});
	ipcMain.handle("vetta:plugins:storage:read-json", (_event, sessionId: unknown, key: unknown) =>
		capabilityAdapter.readStorageJson(asPluginId(sessionId), asPluginId(key)),
	);
	ipcMain.handle("vetta:plugins:storage:write-json", (_event, sessionId: unknown, key: unknown, value: unknown) =>
		capabilityAdapter.writeStorageJson(asPluginId(sessionId), asPluginId(key), value),
	);
	ipcMain.handle("vetta:plugins:storage:list", (_event, sessionId: unknown, prefix: unknown) =>
		capabilityAdapter.listStorage(asPluginId(sessionId), prefix === undefined ? undefined : asPluginId(prefix)),
	);
	ipcMain.handle("vetta:plugins:storage:read-file", (_event, sessionId: unknown, path: unknown) =>
		capabilityAdapter.readStorageFile(asPluginId(sessionId), asPluginId(path)),
	);
	ipcMain.handle("vetta:plugins:storage:write-file", (_event, sessionId: unknown, path: unknown, data: unknown) => {
		if (typeof data !== "string") throw new Error("Invalid plugin storage data");
		return capabilityAdapter.writeStorageFile(asPluginId(sessionId), asPluginId(path), data);
	});
	ipcMain.handle("vetta:plugins:storage:put-blob", (_event, sessionId: unknown, input: unknown) =>
		capabilityAdapter.putStorageBlob(asPluginId(sessionId), input),
	);
	ipcMain.handle("vetta:plugins:storage:put-blob-from-file", (_event, sessionId: unknown, input: unknown) =>
		capabilityAdapter.putStorageBlobFromFile(asPluginId(sessionId), input),
	);
	ipcMain.handle("vetta:plugins:storage:read-blob", (_event, sessionId: unknown, blobId: unknown) =>
		capabilityAdapter.readStorageBlob(asPluginId(sessionId), asPluginId(blobId)),
	);
	ipcMain.handle("vetta:plugins:storage:get-blob-ref", (_event, sessionId: unknown, blobId: unknown) =>
		capabilityAdapter.getStorageBlobRef(asPluginId(sessionId), asPluginId(blobId)),
	);

	return () => {
		ipcMain.removeHandler("vetta:plugins:list");
		ipcMain.removeHandler("vetta:plugins:list-all");
		ipcMain.removeHandler("vetta:plugins:install-from-archive");
		ipcMain.removeHandler("vetta:plugins:install-from-url");
		ipcMain.removeHandler("vetta:plugins:install-from-path");
		ipcMain.removeHandler("vetta:plugins:register-mode-gate");
		ipcMain.removeHandler("vetta:plugins:set-contribution-mode");
		ipcMain.removeHandler("vetta:plugins:uninstall");
		ipcMain.removeHandler("vetta:plugins:set-enabled");
		ipcMain.removeHandler("vetta:plugins:grant-permissions");
		ipcMain.removeHandler("vetta:plugins:revoke-permissions");
		ipcMain.removeHandler("vetta:plugins:grant-commands");
		ipcMain.removeHandler("vetta:plugins:revoke-commands");
		ipcMain.removeHandler("vetta:plugins:command-run");
		ipcMain.removeHandler("vetta:plugins:command-spawn");
		ipcMain.removeHandler("vetta:plugins:command-spawn-stop");
		ipcMain.removeHandler("vetta:plugins:command-spawn-status");
		ipcMain.removeHandler("vetta:plugins:offscreen-capture");
		ipcMain.removeHandler("vetta:plugins:offscreen-release");
		stopAllPluginSpawns();
		destroyAllOffscreenSessions();
		ipcMain.removeHandler("vetta:plugins:reload");
		ipcMain.removeHandler("vetta:plugins:dev-watch-start");
		ipcMain.removeHandler("vetta:plugins:dev-watch-stop");
		ipcMain.removeHandler("vetta:plugins:agent-contributions-begin-load");
		ipcMain.removeHandler("vetta:plugins:agent-tool-register");
		ipcMain.removeHandler("vetta:plugins:agent-tool-unregister");
		ipcMain.removeHandler("vetta:plugins:agent-contributions-clear");
		ipcMain.removeHandler("vetta:plugins:app-action-register");
		ipcMain.removeHandler("vetta:plugins:app-action-activation-commit");
		ipcMain.removeHandler("vetta:plugins:app-action-activation-abort");
		ipcMain.removeHandler("vetta:plugins:app-action-unregister");
		ipcMain.removeHandler("vetta:plugins:app-action-response");
		ipcMain.removeHandler("vetta:plugins:continuation-register");
		ipcMain.removeHandler("vetta:plugins:continuation-unregister");
		ipcMain.removeHandler("vetta:plugins:system-prompt-provider-register");
		ipcMain.removeHandler("vetta:plugins:system-prompt-provider-unregister");
		ipcMain.removeHandler("vetta:plugins:get-settings");
		ipcMain.removeHandler("vetta:plugins:set-settings");
		ipcMain.removeHandler("vetta:plugins:network:request");
		ipcMain.removeHandler("vetta:plugins:gateway:request");
		ipcMain.removeHandler("vetta:plugins:storage:read-json");
		ipcMain.removeHandler("vetta:plugins:storage:write-json");
		ipcMain.removeHandler("vetta:plugins:storage:list");
		ipcMain.removeHandler("vetta:plugins:storage:read-file");
		ipcMain.removeHandler("vetta:plugins:storage:write-file");
		ipcMain.removeHandler("vetta:plugins:storage:put-blob");
		ipcMain.removeHandler("vetta:plugins:storage:put-blob-from-file");
		ipcMain.removeHandler("vetta:plugins:storage:read-blob");
		ipcMain.removeHandler("vetta:plugins:storage:get-blob-ref");
		for (const channel of Object.values(PLUGIN_SYSTEM_CHANNELS)) ipcMain.removeHandler(channel);
		pluginActionService.dispose();
	};
}
