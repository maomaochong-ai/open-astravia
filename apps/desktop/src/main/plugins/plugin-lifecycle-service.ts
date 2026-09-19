import type {
	AppMonitorEvent,
	AppMonitorResourceOperation,
	AppMonitorResourceSource,
} from "../../preload/api-types/app-monitor.js";
import type { InstalledPlugin, PluginInstallOptions, PluginPermission } from "../../preload/api-types/plugins.js";
import type { AbilityInstallLogInput, AbilityLifecycleLogContext } from "../abilities/ability-lifecycle-log.js";
import type { PluginActionService } from "./plugin-action-service.js";

export interface PluginLifecycleDependencies {
	listPlugins(): InstalledPlugin[];
	installFromArchive(buffer: ArrayBuffer | Buffer, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	installFromUrl(url: string, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	installFromPath(path: string, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	uninstall(id: string): void;
	setEnabled(id: string, enabled: boolean): InstalledPlugin;
	grantPermissions(id: string, permissions: PluginPermission[]): InstalledPlugin;
	revokePermissions(id: string, permissions: PluginPermission[]): InstalledPlugin;
	grantCommands(id: string, names: string[]): InstalledPlugin;
	revokeCommands(id: string, names: string[]): InstalledPlugin;
	applySetup?(
		id: string,
		input: { enabled: boolean; grantedPermissions: PluginPermission[]; grantedCommands: string[] },
	): InstalledPlugin;
	reload(id: string): InstalledPlugin;
	stopDevWatch(id: string): void;
	stopSpawns(id: string): void;
	ensureCliProviders(id: string): void;
	stopCliProviders(id: string): void;
	stopServices(id: string): void;
	destroyOffscreenSessions(id: string): void;
	hardRevokeAgentHandlers(
		id: string,
		reason: string,
		kinds?: readonly ("tool" | "hook" | "continuation" | "system-prompt")[],
	): void;
	refreshRuntime(): void;
	recordEvent(input: AppMonitorEvent, logContext?: AbilityLifecycleLogContext): void;
	logInstallStarted(input: AbilityInstallLogInput): void;
	logInstallFailed(input: AbilityInstallLogInput, error: unknown): void;
}

export class PluginLifecycleService {
	constructor(
		private readonly actionService: Pick<PluginActionService, "clear">,
		private readonly dependencies: PluginLifecycleDependencies,
	) {}

	/** 已安装插件一律返回：工作模式不再隐藏任何插件（零硬闸决策）。 */
	list(): InstalledPlugin[] {
		return this.dependencies.listPlugins();
	}

	async installArchive(buffer: ArrayBuffer | Buffer, options?: PluginInstallOptions): Promise<InstalledPlugin> {
		return this.installWithLogging(pluginArchiveInstallContext(options), () =>
			this.dependencies.installFromArchive(buffer, options),
		);
	}

	async installUrl(url: string, options?: PluginInstallOptions): Promise<InstalledPlugin> {
		return this.installWithLogging(pluginUrlInstallContext(url, options), () =>
			this.dependencies.installFromUrl(url, options),
		);
	}

	async installPath(path: string, options?: PluginInstallOptions): Promise<InstalledPlugin> {
		return this.installWithLogging(pluginPathInstallContext(path, options), () =>
			this.dependencies.installFromPath(path, options),
		);
	}

	async installOfficialPath(path: string, options?: PluginInstallOptions): Promise<InstalledPlugin> {
		const enable = options?.enable !== false;
		let plugin = await this.installPath(path, {
			...options,
			source: options?.source ?? "archive",
			enable,
		});
		if ((!options?.grantedPermissions || options.grantedPermissions.length === 0) && plugin.permissions.length > 0) {
			plugin = this.grantPermissions(plugin.id, plugin.permissions);
		}
		return this.setEnabled(plugin.id, enable);
	}

	uninstall(id: string): void {
		const plugin = this.dependencies.listPlugins().find((candidate) => candidate.id === id);
		this.dependencies.hardRevokeAgentHandlers(id, "Plugin was uninstalled");
		this.stopPluginResources(id, true);
		this.dependencies.uninstall(id);
		this.actionService.clear(id);
		this.dependencies.refreshRuntime();
		if (plugin) this.recordPluginEvent(plugin, "uninstalled");
	}

	setEnabled(id: string, enabled: boolean): InstalledPlugin {
		if (!enabled) this.stopPluginResources(id, true);
		const plugin = this.dependencies.setEnabled(id, enabled);
		if (plugin.enabled) {
			this.dependencies.ensureCliProviders(id);
		}
		if (!plugin.enabled) this.actionService.clear(id);
		this.dependencies.refreshRuntime();
		this.recordPluginEvent(plugin, plugin.enabled ? "enabled" : "disabled");
		return plugin;
	}

	grantPermissions(id: string, permissions: PluginPermission[]): InstalledPlugin {
		const previous = this.findPlugin(id)?.grantedPermissions ?? [];
		const plugin = this.dependencies.grantPermissions(id, permissions);
		this.dependencies.refreshRuntime();
		this.recordPluginEvent(plugin, "permissions-granted", {
			permissionCount: countAdded(previous, plugin.grantedPermissions),
		});
		return plugin;
	}

	revokePermissions(id: string, permissions: PluginPermission[]): InstalledPlugin {
		const previous = this.findPlugin(id)?.grantedPermissions ?? [];
		const plugin = this.dependencies.revokePermissions(id, permissions);
		const revokedKinds: Array<"tool" | "hook" | "continuation" | "system-prompt"> = [];
		if (
			!plugin.grantedPermissions.includes("agent.tools.register") ||
			!plugin.grantedPermissions.includes("agent.toolHandler.execute")
		)
			revokedKinds.push("tool");
		if (
			!plugin.grantedPermissions.includes("agent.hooks.register") ||
			!plugin.grantedPermissions.includes("agent.hookHandler.execute")
		)
			revokedKinds.push("hook");
		if (!plugin.grantedPermissions.includes("agent.continuation.register")) revokedKinds.push("continuation");
		if (
			!plugin.grantedPermissions.includes("agent.systemPrompt.write") &&
			!plugin.grantedPermissions.includes("agent.systemPrompt.fullControl")
		)
			revokedKinds.push("system-prompt");
		if (revokedKinds.length > 0) {
			this.dependencies.hardRevokeAgentHandlers(id, "Plugin Agent permission was revoked", revokedKinds);
		}
		if (
			!plugin.grantedPermissions.includes("app.actions.register") ||
			!plugin.grantedPermissions.includes("app.actionHandler.execute")
		) {
			this.actionService.clear(id);
		}
		this.dependencies.refreshRuntime();
		this.recordPluginEvent(plugin, "permissions-revoked", {
			permissionCount: countRemoved(previous, plugin.grantedPermissions),
		});
		return plugin;
	}

	grantCommands(id: string, names: string[]): InstalledPlugin {
		const previous = this.findPlugin(id)?.grantedCommandNames ?? [];
		const plugin = this.dependencies.grantCommands(id, names);
		this.recordPluginEvent(plugin, "commands-granted", {
			commandCount: countAdded(previous, plugin.grantedCommandNames),
		});
		return plugin;
	}

	revokeCommands(id: string, names: string[]): InstalledPlugin {
		const previous = this.findPlugin(id)?.grantedCommandNames ?? [];
		const plugin = this.dependencies.revokeCommands(id, names);
		this.recordPluginEvent(plugin, "commands-revoked", {
			commandCount: countRemoved(previous, plugin.grantedCommandNames),
		});
		return plugin;
	}

	applySetup(
		id: string,
		input: { enabled: boolean; grantedPermissions: PluginPermission[]; grantedCommands: string[] },
	): InstalledPlugin {
		const previous = this.findPlugin(id);
		if (!this.dependencies.applySetup) throw new Error("Plugin setup transaction is unavailable");
		const plugin = this.dependencies.applySetup(id, input);
		if (previous && !plugin.grantedPermissions.includes("agent.tools.register")) {
			this.dependencies.hardRevokeAgentHandlers(id, "Plugin Agent permission was revoked", ["tool"]);
		}
		if (plugin.enabled) this.dependencies.ensureCliProviders(id);
		else this.actionService.clear(id);
		this.dependencies.refreshRuntime();
		if (previous?.enabled !== plugin.enabled) {
			this.recordPluginEvent(plugin, plugin.enabled ? "enabled" : "disabled");
		}
		const grantedPermissionCount = countAdded(previous?.grantedPermissions ?? [], plugin.grantedPermissions);
		if (grantedPermissionCount > 0) {
			this.recordPluginEvent(plugin, "permissions-granted", { permissionCount: grantedPermissionCount });
		}
		const revokedPermissionCount = countRemoved(previous?.grantedPermissions ?? [], plugin.grantedPermissions);
		if (revokedPermissionCount > 0) {
			this.recordPluginEvent(plugin, "permissions-revoked", { permissionCount: revokedPermissionCount });
		}
		const grantedCommandCount = countAdded(previous?.grantedCommandNames ?? [], plugin.grantedCommandNames);
		if (grantedCommandCount > 0) {
			this.recordPluginEvent(plugin, "commands-granted", { commandCount: grantedCommandCount });
		}
		const revokedCommandCount = countRemoved(previous?.grantedCommandNames ?? [], plugin.grantedCommandNames);
		if (revokedCommandCount > 0) {
			this.recordPluginEvent(plugin, "commands-revoked", { commandCount: revokedCommandCount });
		}
		return plugin;
	}

	reload(id: string): InstalledPlugin {
		this.stopPluginResources(id, false);
		const plugin = this.dependencies.reload(id);
		if (plugin.enabled) {
			this.dependencies.ensureCliProviders(id);
		}
		this.dependencies.refreshRuntime();
		this.recordPluginEvent(plugin, "reloaded");
		return plugin;
	}

	stopDevWatch(id: string): void {
		this.dependencies.stopDevWatch(id);
		this.dependencies.refreshRuntime();
	}

	private async installWithLogging(
		context: AbilityInstallLogInput,
		install: () => Promise<InstalledPlugin>,
	): Promise<InstalledPlugin> {
		this.dependencies.logInstallStarted(context);
		try {
			return this.finishInstall(await install(), context);
		} catch (error) {
			this.dependencies.logInstallFailed(context, error);
			throw error;
		}
	}

	private finishInstall(plugin: InstalledPlugin, context: AbilityInstallLogInput): InstalledPlugin {
		const { abilityType: _abilityType, abilityId: _abilityId, ...installContext } = context;
		this.recordPluginEvent(
			plugin,
			plugin.installedAt === plugin.updatedAt ? "installed" : "updated",
			{},
			{
				...installContext,
				version: plugin.activeVersion,
			},
		);
		if (plugin.enabled) {
			this.dependencies.ensureCliProviders(plugin.id);
		}
		this.dependencies.refreshRuntime();
		return plugin;
	}

	private findPlugin(id: string): InstalledPlugin | undefined {
		return this.dependencies.listPlugins().find((candidate) => candidate.id === id);
	}

	private stopPluginResources(id: string, includeDevWatch: boolean): void {
		if (includeDevWatch) this.dependencies.stopDevWatch(id);
		this.dependencies.stopSpawns(id);
		this.dependencies.stopCliProviders(id);
		this.dependencies.stopServices(id);
		this.dependencies.destroyOffscreenSessions(id);
	}

	private recordPluginEvent(
		plugin: Pick<InstalledPlugin, "id" | "source">,
		operation: AppMonitorResourceOperation,
		counts: { permissionCount?: number; commandCount?: number } = {},
		logContext?: AbilityLifecycleLogContext,
	): void {
		try {
			const event: AppMonitorEvent = {
				type: "resource.lifecycle",
				resourceKind: "plugin",
				operation,
				resourceId: plugin.id,
				source: toAppMonitorPluginSource(plugin.source),
				system: plugin.source === "system",
				...counts,
			};
			if (logContext) this.dependencies.recordEvent(event, logContext);
			else this.dependencies.recordEvent(event);
		} catch {
			// Monitoring must not affect plugin operations.
		}
	}
}

function installMode(options: PluginInstallOptions | undefined, fallback: "manual-package" | "plugin-api") {
	if (options?.initiator === "plugin-cli") return "plugin-cli" as const;
	if (options?.initiator === "plugin-workbench") return "plugin-workbench" as const;
	return fallback;
}

function artifactKind(value: string): "vettapkg" | "legacy-zip" | "remote-archive" {
	const lower = value.toLowerCase();
	if (lower.endsWith(".vettapkg")) return "vettapkg";
	if (lower.endsWith(".zip")) return "legacy-zip";
	return "remote-archive";
}

function pluginArchiveInstallContext(options: PluginInstallOptions | undefined): AbilityInstallLogInput {
	return {
		abilityType: "plugin",
		...(options?.expectedId ? { abilityId: options.expectedId } : {}),
		...(options?.expectedVersion ? { version: options.expectedVersion } : {}),
		installMode: installMode(options, "plugin-api"),
		artifactKind: options?.source === "npm" ? "npm-package" : "archive-buffer",
		...(options?.expectedSha256 ? { artifactSha256: options.expectedSha256 } : {}),
		...(options?.npm?.packageName ? { npmPackage: options.npm.packageName } : {}),
	};
}

function pluginPathInstallContext(path: string, options: PluginInstallOptions | undefined): AbilityInstallLogInput {
	const normalized = path.replaceAll("\\", "/");
	const artifactName = normalized.slice(normalized.lastIndexOf("/") + 1);
	return {
		abilityType: "plugin",
		...(options?.expectedId ? { abilityId: options.expectedId } : {}),
		...(options?.expectedVersion ? { version: options.expectedVersion } : {}),
		installMode: installMode(options, "manual-package"),
		artifactKind: options?.source === "npm" ? "npm-package" : artifactKind(artifactName),
		artifactName,
		...(options?.expectedSha256 ? { artifactSha256: options.expectedSha256 } : {}),
		...(options?.npm?.packageName ? { npmPackage: options.npm.packageName } : {}),
	};
}

function pluginUrlInstallContext(url: string, options: PluginInstallOptions | undefined): AbilityInstallLogInput {
	const parsed = new URL(url);
	const artifactName = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
	return {
		abilityType: "plugin",
		...(options?.expectedId ? { abilityId: options.expectedId } : {}),
		...(options?.expectedVersion ? { version: options.expectedVersion } : {}),
		installMode: installMode(options, "plugin-api"),
		artifactKind: artifactKind(artifactName),
		...(artifactName ? { artifactName } : {}),
		artifactUrl: parsed.origin + parsed.pathname,
		...(options?.expectedSha256 ? { artifactSha256: options.expectedSha256 } : {}),
	};
}

function toAppMonitorPluginSource(source: InstalledPlugin["source"]): AppMonitorResourceSource {
	if (source === "system") return "system";
	if (source === "remote") return "remote";
	if (source === "npm") return "npm";
	return "archive";
}

function countAdded(previous: readonly string[], next: readonly string[]): number {
	const before = new Set(previous);
	return next.filter((item) => !before.has(item)).length;
}

function countRemoved(previous: readonly string[], next: readonly string[]): number {
	const after = new Set(next);
	return previous.filter((item) => !after.has(item)).length;
}
