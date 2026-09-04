import { webContents } from "electron";
import { PLUGIN_CONTRIBUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { refreshAgentPlugins } from "./plugin-runtime-service.js";

/** Publish one effective settings snapshot to every active plugin consumer. */
export function publishPluginSettingsChanged(pluginId: string, values: Record<string, unknown>): void {
	refreshAgentPlugins({ reason: "contribution:settings-change", pluginId });
	for (const contents of webContents.getAllWebContents()) {
		if (contents.isDestroyed()) continue;
		contents.send(PLUGIN_CONTRIBUTION_CHANNELS.SETTINGS_CHANGED, { pluginId, values });
	}
}
