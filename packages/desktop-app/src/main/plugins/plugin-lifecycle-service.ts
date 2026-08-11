import type {
	AppMonitorEvent,
	AppMonitorResourceOperation,
	AppMonitorResourceSource,
} from "../../preload/api-types/app-monitor.js";
import type { InstalledPlugin, PluginInstallOptions, PluginPermission } from "../../preload/api-types/plugins.js";
import type { PluginActionService } from "./plugin-action-service.js";
import { pluginVisibleInAgentMode } from "./plugin-agent-mode-policy.js";

export interface PluginLifecycleDependencies {
	listPlugins(): InstalledPlugin[];
	readAgentMode(): Promise<string | undefined>;
	installFromArchive(buffer: ArrayBuffer | Buffer, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	installFromUrl(url: string, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	installFromPath(path: string, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	uninstall(id: string): void;
	setEnabled(id: string, enabled: boolean): InstalledPlugin;
	grantPermissions(id: string, permissions: PluginPermission[]): InstalledPlugin;
	revokePermissions(id: string, permissions: PluginPermission[]): InstalledPlugin;
	grantCommands(id: string, names: string[]): InstalledPlugin;
	revokeCommands(id: string, names: string[]): InstalledPlugin;
	reload(id: string): InstalledPlugin;
	stopDevWatch(id: string): void;
	stopSpawns(id: string): void;
	destroyOffscreenSessions(id: string): void;
	refreshRuntime(): void;
	recordEvent(input: AppMonitorEvent): void;
}

export class PluginLifecycleService {
	constructor(
		private readonly actionService: Pick<PluginActionService, "clear">,
		private readonly dependencies: PluginLifecycleDependencies,
	) {}

	async listVisible(): Promise<InstalledPlugin[]> {
		const mode = (await this.dependencies.readAgentMode()) ?? "work";
		return this.dependencies.listPlugins().filter((plugin) => pluginVisibleInAgentMode(plugin, mode));
	}

	async installArchive(buffer: ArrayBuffer | Buffer, options?: PluginInstallOptions): Promise<InstalledPlugin> {
		return this.finishInstall(await this.dependencies.installFromArchive(buffer, options));
	}

	async installUrl(url: string, options?: PluginInstallOptions): Promise<InstalledPlugin> {
		return this.finishInstall(await this.dependencies.installFromUrl(url, options));
	}

	async installPath(path: string, options?: PluginInstallOptions): Promise<InstalledPlugin> {
		return this.finishInstall(await this.dependencies.installFromPath(path, options));
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
		this.stopPluginResources(id, true);
		this.dependencies.uninstall(id);
		this.actionService.clear(id);
		this.dependencies.refreshRuntime();
		if (plugin) this.recordPluginEvent(plugin, "uninstalled");
	}

	setEnabled(id: string, enabled: boolean): InstalledPlugin {
		if (!enabled) this.stopPluginResources(id, true);
		const plugin = this.dependencies.setEnabled(id, enabled);
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

	reload(id: string): InstalledPlugin {
		this.stopPluginResources(id, false);
		const plugin = this.dependencies.reload(id);
		this.dependencies.refreshRuntime();
		this.recordPluginEvent(plugin, "reloaded");
		return plugin;
	}

	stopDevWatch(id: string): void {
		this.dependencies.stopDevWatch(id);
		this.dependencies.refreshRuntime();
	}

	private finishInstall(plugin: InstalledPlugin): InstalledPlugin {
		this.recordPluginEvent(plugin, plugin.installedAt === plugin.updatedAt ? "installed" : "updated");
		this.dependencies.refreshRuntime();
		return plugin;
	}

	private findPlugin(id: string): InstalledPlugin | undefined {
		return this.dependencies.listPlugins().find((candidate) => candidate.id === id);
	}

	private stopPluginResources(id: string, includeDevWatch: boolean): void {
		if (includeDevWatch) this.dependencies.stopDevWatch(id);
		this.dependencies.stopSpawns(id);
		this.dependencies.destroyOffscreenSessions(id);
	}

	private recordPluginEvent(
		plugin: Pick<InstalledPlugin, "id" | "source">,
		operation: AppMonitorResourceOperation,
		counts: { permissionCount?: number; commandCount?: number } = {},
	): void {
		try {
			this.dependencies.recordEvent({
				type: "resource.lifecycle",
				resourceKind: "plugin",
				operation,
				resourceId: plugin.id,
				source: toAppMonitorPluginSource(plugin.source),
				system: plugin.source === "system",
				...counts,
			});
		} catch {
			// Monitoring must not affect plugin operations.
		}
	}
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
