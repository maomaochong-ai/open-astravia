import { defineRuntimeObservation } from "@vetta/runtime-core/observation";
import type { AgentConfigurationFailureCode } from "./configuration-schema.js";

export interface AgentConfigurationObservation {
	readonly operation: "save" | "apply";
	readonly phase: "started" | "completed" | "failed";
	readonly revision: number;
	readonly code?: AgentConfigurationFailureCode;
}
export const AGENT_CONFIGURATION_OBSERVATION = defineRuntimeObservation<AgentConfigurationObservation>(
	"coding-agent.configuration",
	"lifecycle",
);
