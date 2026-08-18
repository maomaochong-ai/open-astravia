import type { PluginActionService } from "../plugins/plugin-action-service.js";
import { registerPluginContributionIpc } from "./plugin-contributions.js";
import { registerPluginExecutionIpc } from "./plugin-execution.js";
import { registerPluginManagementIpc } from "./plugin-management.js";

export function registerPluginsIpc(pluginActionService: PluginActionService): () => void {
	const unregister = [
		registerPluginManagementIpc(pluginActionService),
		registerPluginExecutionIpc(),
		registerPluginContributionIpc(pluginActionService),
	];

	return () => {
		for (const teardown of unregister) teardown();
	};
}
