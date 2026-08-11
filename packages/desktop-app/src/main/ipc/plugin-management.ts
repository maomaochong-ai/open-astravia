import { ipcMain } from "electron";
import { PLUGIN_SYSTEM_CHANNELS } from "../../shared/plugin-capability-ipc.js";
import { PLUGIN_MANAGEMENT_CHANNELS } from "../../shared/plugin-ipc.js";
import { getDesktopCapabilityHost } from "../capabilities/capability-host.js";
import type { PluginActionService } from "../plugins/plugin-action-service.js";
import { startPluginDevWatch } from "../plugins/plugin-dev-watch.js";
import { createPluginLifecycleService } from "../plugins/plugin-lifecycle-production.js";
import { refreshAgentPlugins } from "../plugins/plugin-runtime-service.js";
import { listPlugins, registerPluginModeGate, setPluginContributionMode } from "../plugins/plugin-store.js";
import {
	asArchiveBuffer,
	asCommandNames,
	asOptions,
	asPermissions,
	asPluginId,
	asRequiredString,
} from "./plugin-input-parsers.js";

export function registerPluginManagementIpc(pluginActionService: PluginActionService): () => void {
	const capabilityAdapter = getDesktopCapabilityHost().adapters.plugin;
	const lifecycle = createPluginLifecycleService(pluginActionService);

	// The renderer must not observe plugins excluded by the agent_mode gate. See ADR-0046.
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.LIST, () => lifecycle.listVisible());
	// The capability marketplace needs the complete installed inventory across modes.
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.LIST_ALL, () => listPlugins());
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.INSTALL_FROM_ARCHIVE, (_event, archiveBuffer: unknown, options: unknown) =>
		lifecycle.installArchive(asArchiveBuffer(archiveBuffer), asOptions(options)),
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.INSTALL_FROM_URL, (_event, url: unknown, options: unknown) =>
		lifecycle.installUrl(asRequiredString(url, "plugin URL"), asOptions(options)),
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.INSTALL_FROM_PATH, (_event, path: unknown, options: unknown) =>
		lifecycle.installPath(asRequiredString(path, "plugin path"), asOptions(options)),
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.REGISTER_MODE_GATE, (_event, id: unknown) => {
		registerPluginModeGate(asPluginId(id));
		refreshAgentPlugins();
	});
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.SET_CONTRIBUTION_MODE, (_event, id: unknown, active: unknown) => {
		setPluginContributionMode(asPluginId(id), active === true);
		refreshAgentPlugins();
	});
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.UNINSTALL, (_event, id: unknown) => lifecycle.uninstall(asPluginId(id)));
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.SET_ENABLED, (_event, id: unknown, enabled: unknown) =>
		lifecycle.setEnabled(asPluginId(id), enabled === true),
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.GRANT_PERMISSIONS, (_event, id: unknown, permissions: unknown) =>
		lifecycle.grantPermissions(asPluginId(id), asPermissions(permissions)),
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.REVOKE_PERMISSIONS, (_event, id: unknown, permissions: unknown) =>
		lifecycle.revokePermissions(asPluginId(id), asPermissions(permissions)),
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.GRANT_COMMANDS, (_event, id: unknown, names: unknown) =>
		lifecycle.grantCommands(asPluginId(id), asCommandNames(names)),
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.REVOKE_COMMANDS, (_event, id: unknown, names: unknown) =>
		lifecycle.revokeCommands(asPluginId(id), asCommandNames(names)),
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.RELOAD, (_event, id: unknown) => lifecycle.reload(asPluginId(id)));

	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.LIST, (_event, sessionId: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return lifecycle.listVisible();
	});
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.INSTALL_FROM_URL, (_event, sessionId: unknown, url: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return lifecycle.installUrl(asRequiredString(url, "plugin URL"));
	});
	ipcMain.handle(
		PLUGIN_SYSTEM_CHANNELS.INSTALL_FROM_PATH,
		(_event, sessionId: unknown, path: unknown, options: unknown) => {
			capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
			return lifecycle.installOfficialPath(asRequiredString(path, "plugin path"), asOptions(options));
		},
	);
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.UNINSTALL, (_event, sessionId: unknown, id: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return lifecycle.uninstall(asPluginId(id));
	});
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.SET_ENABLED, (_event, sessionId: unknown, id: unknown, enabled: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return lifecycle.setEnabled(asPluginId(id), enabled === true);
	});
	ipcMain.handle(PLUGIN_SYSTEM_CHANNELS.RELOAD, (_event, sessionId: unknown, id: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		return lifecycle.reload(asPluginId(id));
	});
	ipcMain.handle(
		PLUGIN_MANAGEMENT_CHANNELS.DEV_WATCH_START,
		(_event, sessionId: unknown, id: unknown, projectDir: unknown) => {
			capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
			const pluginId = asPluginId(id);
			if (typeof projectDir !== "string" || projectDir.trim().length === 0) {
				throw new Error("Invalid plugin project dir");
			}
			return startPluginDevWatch(pluginId, projectDir.trim());
		},
	);
	ipcMain.handle(PLUGIN_MANAGEMENT_CHANNELS.DEV_WATCH_STOP, (_event, sessionId: unknown, id: unknown) => {
		capabilityAdapter.assertOfficialSession(asPluginId(sessionId));
		lifecycle.stopDevWatch(asPluginId(id));
	});

	return () => {
		for (const channel of Object.values(PLUGIN_MANAGEMENT_CHANNELS)) ipcMain.removeHandler(channel);
		for (const channel of Object.values(PLUGIN_SYSTEM_CHANNELS)) ipcMain.removeHandler(channel);
	};
}
