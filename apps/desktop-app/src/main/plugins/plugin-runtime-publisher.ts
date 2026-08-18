import type { AgentPluginRuntimeConfig } from "@vetta/runtime-core";
import {
	type AgentPluginRuntimeFingerprints,
	fingerprintAgentPluginRuntimeConfig,
} from "./plugin-runtime-fingerprint.js";

interface AgentPluginRuntimePublisherLogger {
	debug(message: string, data: Record<string, unknown>): void;
}

export interface AgentPluginRuntimeRefreshOptions {
	reason?: string;
	pluginId?: string;
	/** Rebuild runtime resources even when the serializable topology is unchanged. */
	force?: boolean;
}

export interface AgentPluginRuntimeRefreshResult extends AgentPluginRuntimeFingerprints {
	applied: boolean;
	forced: boolean;
	modelTopologyChanged: boolean;
}

export interface AgentPluginRuntimePublisherDependencies {
	build(): AgentPluginRuntimeConfig | undefined;
	apply(config: AgentPluginRuntimeConfig | undefined): void;
	summarize(config: AgentPluginRuntimeConfig | undefined): Record<string, unknown>;
	logger: AgentPluginRuntimePublisherLogger;
}

/** Publishes immutable plugin topology while suppressing semantically identical snapshots. */
export class AgentPluginRuntimePublisher {
	private previous: AgentPluginRuntimeFingerprints | undefined;

	constructor(private readonly dependencies: AgentPluginRuntimePublisherDependencies) {}

	refresh(options: AgentPluginRuntimeRefreshOptions = {}): AgentPluginRuntimeRefreshResult {
		const config = this.dependencies.build();
		const fingerprints = fingerprintAgentPluginRuntimeConfig(config);
		const forced = options.force === true;
		const modelTopologyChanged = this.previous?.modelTopology !== fingerprints.modelTopology;
		const applied = forced || this.previous?.runtime !== fingerprints.runtime;
		const diagnostics = {
			reason: options.reason ?? "unspecified",
			pluginId: options.pluginId,
			forced,
			runtimeFingerprint: fingerprints.runtime,
			previousRuntimeFingerprint: this.previous?.runtime,
			modelTopologyFingerprint: fingerprints.modelTopology,
			previousModelTopologyFingerprint: this.previous?.modelTopology,
			modelTopologyChanged,
			...this.dependencies.summarize(config),
		};
		if (!applied) {
			this.dependencies.logger.debug("skip unchanged agent plugin runtime", diagnostics);
			return { ...fingerprints, applied, forced, modelTopologyChanged };
		}

		this.dependencies.apply(config);
		this.previous = fingerprints;
		this.dependencies.logger.debug("publish agent plugin runtime", diagnostics);
		return { ...fingerprints, applied, forced, modelTopologyChanged };
	}
}
