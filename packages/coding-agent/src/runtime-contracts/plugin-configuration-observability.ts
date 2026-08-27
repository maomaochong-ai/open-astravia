import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core/observation";

export interface CodingAgentPluginConfigurationObservation {
	readonly phase: "started" | "completed" | "failed";
	readonly source: "host" | "session-override";
	readonly boundary: "idle" | "turn";
	readonly durationMs?: number;
	readonly failure?: RuntimeObservationFailure;
}

export const CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION =
	defineRuntimeObservation<CodingAgentPluginConfigurationObservation>(
		"coding-agent.plugin-configuration",
		"lifecycle",
	);
