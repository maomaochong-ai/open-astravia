import type { LoadedPlugin } from "./plugin-local-contributions";
import { logPluginRuntimeError } from "./plugin-runtime-log";

export async function disposePlugins(plugins: readonly LoadedPlugin[], reason: string): Promise<void> {
	await Promise.all(
		plugins.map(async (plugin) => {
			try {
				await plugin.dispose();
			} catch (error) {
				logPluginRuntimeError(
					"plugin disposal failed",
					{
						pluginId: plugin.id,
						pluginVersion: plugin.version,
						stage: "dispose",
						reason,
					},
					error,
				);
			}
		}),
	);
}
