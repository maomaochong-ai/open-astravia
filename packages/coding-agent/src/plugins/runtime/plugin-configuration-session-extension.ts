import { defineSessionExtensionService, type SessionExtensionDefinition } from "@vetta/runtime-core/session-extensions";
import type { CodingAgentPluginConfigurationRuntime } from "./plugin-configuration-runtime.js";
import {
	CODING_AGENT_PLUGIN_CONFIGURATION_APPLY,
	CODING_AGENT_PLUGIN_CONFIGURATION_EXTENSION_ID,
	CODING_AGENT_PLUGIN_CONFIGURATION_REFRESH,
} from "./plugin-configuration-session-extension-contract.js";

interface CodingAgentPluginConfigurationRuntimeOwner {
	attach(runtime: CodingAgentPluginConfigurationRuntime): void;
	read(): CodingAgentPluginConfigurationRuntime | undefined;
}

export const CODING_AGENT_PLUGIN_CONFIGURATION_RUNTIME_OWNER =
	defineSessionExtensionService<CodingAgentPluginConfigurationRuntimeOwner>(
		CODING_AGENT_PLUGIN_CONFIGURATION_EXTENSION_ID,
		"runtime-owner",
	);

export function createCodingAgentPluginConfigurationSessionExtension(): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_PLUGIN_CONFIGURATION_EXTENSION_ID,
		create() {
			let runtime: CodingAgentPluginConfigurationRuntime | undefined;
			const owner: CodingAgentPluginConfigurationRuntimeOwner = {
				attach(next) {
					if (runtime) throw new Error("Coding Agent Plugin configuration runtime is already attached");
					runtime = next;
				},
				read: () => runtime,
			};
			return {
				contributions: [
					{ kind: "service", token: CODING_AGENT_PLUGIN_CONFIGURATION_RUNTIME_OWNER, value: owner },
					{
						kind: "endpoint",
						token: CODING_AGENT_PLUGIN_CONFIGURATION_REFRESH,
						handle: () => requireRuntime(runtime).refreshBase(),
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_PLUGIN_CONFIGURATION_APPLY,
						handle: ({ agentPlugins }) => requireRuntime(runtime).applyOverride(agentPlugins),
					},
				],
				dispose: () => runtime?.dispose(),
			};
		},
	};
}

function requireRuntime(
	runtime: CodingAgentPluginConfigurationRuntime | undefined,
): CodingAgentPluginConfigurationRuntime {
	if (!runtime) throw new Error("Coding Agent Plugin configuration runtime has not been attached");
	return runtime;
}
