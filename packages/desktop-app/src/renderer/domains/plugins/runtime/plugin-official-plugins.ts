import type { InstalledPlugin } from "@preload/api";
import type { PluginOfficialApi, PluginOfficialPluginSummary } from "@vetta-org/plugin-sdk";

function summarizePlugin(plugin: InstalledPlugin): PluginOfficialPluginSummary {
	return {
		id: plugin.id,
		name: plugin.name,
		version: plugin.version,
		enabled: plugin.enabled,
		required: plugin.required,
		source: plugin.source,
		permissions: plugin.grantedPermissions,
		description: plugin.description,
		rootPath: plugin.rootPath,
		devWatch: plugin.devWatch,
	};
}

export function createOfficialPluginsApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["plugins"] {
	const pluginSystem = window.vetta.plugins.internalCapabilities.pluginSystem;
	return {
		list: async () => {
			assertOfficial();
			return (await pluginSystem.list(capabilitySessionId)).map(summarizePlugin);
		},
		get: async (id) => {
			assertOfficial();
			const plugin = (await pluginSystem.list(capabilitySessionId)).find((item) => item.id === id);
			if (!plugin) throw new Error(`Plugin not found: ${id}`);
			return summarizePlugin(plugin);
		},
		setEnabled: async (id, enabled) => {
			assertOfficial();
			return summarizePlugin(await pluginSystem.setEnabled(capabilitySessionId, id, enabled));
		},
		installFromUrl: async (url) => {
			assertOfficial();
			return summarizePlugin(await pluginSystem.installFromUrl(capabilitySessionId, url));
		},
		installFromPath: async (path, options) => {
			assertOfficial();
			return summarizePlugin(await pluginSystem.installFromPath(capabilitySessionId, path, options));
		},
		uninstall: async (id) => {
			assertOfficial();
			await pluginSystem.uninstall(capabilitySessionId, id);
		},
		reload: async (id) => {
			assertOfficial();
			return summarizePlugin(await pluginSystem.reload(capabilitySessionId, id));
		},
		grantPermissions: async (id, permissions) => {
			assertOfficial();
			return summarizePlugin(await window.vetta.plugins.grantPermissions(id, permissions));
		},
		startDevWatch: async (id, projectDir) => {
			assertOfficial();
			return summarizePlugin(await window.vetta.plugins.startDevWatch(id, projectDir));
		},
		stopDevWatch: async (id) => {
			assertOfficial();
			await window.vetta.plugins.stopDevWatch(id);
		},
		onChanged: (handler) => {
			assertOfficial();
			return window.vetta.plugins.onPluginsChanged(handler);
		},
	};
}
