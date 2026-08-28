import { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodingAgentSessionConfigurationState } from "../../src/host/session-configuration/configuration-state.js";
import type { AgentPluginRuntimeConfig } from "../../src/model-context/plugin-runtime.js";
import { CodingAgentPluginConfigurationRuntime } from "../../src/plugins/runtime/plugin-configuration-runtime.js";
import {
	CODING_AGENT_PLUGIN_CONFIGURATION_RUNTIME_OWNER,
	createCodingAgentPluginConfigurationSessionExtension,
} from "../../src/plugins/runtime/plugin-configuration-session-extension.js";
import {
	CODING_AGENT_PLUGIN_CONFIGURATION_APPLY,
	CODING_AGENT_PLUGIN_CONFIGURATION_REFRESH,
} from "../../src/plugins/runtime/plugin-configuration-session-extension-contract.js";
import type { CodingAgentPluginRuntimeSource } from "../../src/runtime-contracts/plugin-runtime.js";

describe("CodingAgentPluginConfigurationRuntime", () => {
	let composition: SessionExtensionComposition | undefined;

	afterEach(async () => {
		await composition?.dispose();
		composition = undefined;
	});

	it("publishes host source changes at Turn admission through the product endpoint", async () => {
		const source = mutableSource(configuration("alpha"));
		const state = new CodingAgentSessionConfigurationState(undefined, source.runtime.readAgentPlugins);
		const apply = vi.fn(async () => {});
		const runtime = new CodingAgentPluginConfigurationRuntime({
			configurationState: state,
			source: source.runtime,
			apply,
		});
		composition = await SessionExtensionComposition.create({
			definitions: [createCodingAgentPluginConfigurationSessionExtension()],
		});
		composition.services.require(CODING_AGENT_PLUGIN_CONFIGURATION_RUNTIME_OWNER).attach(runtime);

		source.publish(configuration("beta"));
		await composition.invoke(CODING_AGENT_PLUGIN_CONFIGURATION_REFRESH, undefined);
		await runtime.synchronize("turn-apply");

		expect(apply).toHaveBeenCalledOnce();
		expect(apply).toHaveBeenLastCalledWith(configuration("beta"));
		expect(state.captureRevision()).toMatchObject({ revision: 1, agentPlugins: configuration("beta") });
	});

	it("keeps a failed Session override pending and retries it without publishing a partial revision", async () => {
		const source = mutableSource(configuration("base"));
		const state = new CodingAgentSessionConfigurationState(undefined, source.runtime.readAgentPlugins);
		const apply = vi.fn().mockRejectedValueOnce(new Error("MCP apply failed")).mockResolvedValueOnce(undefined);
		const runtime = new CodingAgentPluginConfigurationRuntime({
			configurationState: state,
			source: source.runtime,
			apply,
		});
		composition = await SessionExtensionComposition.create({
			definitions: [createCodingAgentPluginConfigurationSessionExtension()],
		});
		composition.services.require(CODING_AGENT_PLUGIN_CONFIGURATION_RUNTIME_OWNER).attach(runtime);

		await composition.invoke(CODING_AGENT_PLUGIN_CONFIGURATION_APPLY, {
			agentPlugins: configuration("override"),
		});
		await expect(runtime.synchronize("turn-apply")).rejects.toThrow("MCP apply failed");
		expect(state.captureRevision()).toMatchObject({ revision: 0, agentPlugins: configuration("base") });

		await runtime.synchronize("turn-apply");
		expect(state.captureRevision()).toMatchObject({ revision: 1, agentPlugins: configuration("override") });
		expect(apply).toHaveBeenCalledTimes(2);
	});
});

function mutableSource(initial: AgentPluginRuntimeConfig | undefined): {
	readonly runtime: CodingAgentPluginRuntimeSource;
	publish(config: AgentPluginRuntimeConfig | undefined): void;
} {
	let current = initial;
	const listeners = new Set<() => void>();
	return {
		runtime: {
			readAgentPlugins: () => current,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		publish(config) {
			current = config;
			for (const listener of listeners) listener();
		},
	};
}

function configuration(id: string): AgentPluginRuntimeConfig {
	return {
		skillPathContributions: [{ pluginId: id, paths: [`/${id}`] }],
	};
}
