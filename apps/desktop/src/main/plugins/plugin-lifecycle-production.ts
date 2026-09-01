import { recordAppMonitorEvent } from "../app-monitor/app-monitor-service.js";
import { stopAllSpawnsForPlugin } from "./command-spawner.js";
import { destroyOffscreenSessionsForPlugin } from "./offscreen-capture-service.js";
import type { PluginActionService } from "./plugin-action-service.js";
import {
	grantPluginCommands,
	grantPluginPermissions,
	installPluginFromArchive,
	installPluginFromPath,
	installPluginFromUrl,
	listPlugins,
	pluginAgentContributionService,
	reloadPlugin,
	revokePluginCommands,
	revokePluginPermissions,
	setPluginEnabled,
	uninstallPlugin,
} from "./plugin-catalog.js";
import { pluginCliProviderService } from "./plugin-cli-provider-service.js";
import { stopPluginDevWatch } from "./plugin-dev-watch.js";
import { type PluginLifecycleDependencies, PluginLifecycleService } from "./plugin-lifecycle-service.js";
import { refreshAgentPlugins } from "./plugin-runtime-service.js";

const dependencies: PluginLifecycleDependencies = {
	listPlugins,
	installFromArchive: installPluginFromArchive,
	installFromUrl: installPluginFromUrl,
	installFromPath: installPluginFromPath,
	uninstall: uninstallPlugin,
	setEnabled: setPluginEnabled,
	grantPermissions: grantPluginPermissions,
	revokePermissions: revokePluginPermissions,
	grantCommands: grantPluginCommands,
	revokeCommands: revokePluginCommands,
	reload: reloadPlugin,
	stopDevWatch: stopPluginDevWatch,
	stopSpawns: stopAllSpawnsForPlugin,
	ensureCliProviders: (id) => pluginCliProviderService.ensurePlugin(id),
	stopCliProviders: (id) => pluginCliProviderService.disablePlugin(id),
	destroyOffscreenSessions: destroyOffscreenSessionsForPlugin,
	hardRevokeAgentHandlers: (id, reason, kinds) => {
		pluginAgentContributionService.hardRevokeHandlers(id, reason, kinds);
	},
	refreshRuntime: refreshAgentPlugins,
	recordEvent: recordAppMonitorEvent,
};

export function createPluginLifecycleService(pluginActionService: PluginActionService): PluginLifecycleService {
	return new PluginLifecycleService(pluginActionService, dependencies);
}
