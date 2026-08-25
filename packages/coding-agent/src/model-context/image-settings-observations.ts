import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core/observation";

export interface CodingAgentConfigurationIssueObservation {
	readonly operation: "legacy-settings.refresh" | "snapshot.route";
	readonly code: "legacy-settings-read-failed" | "scope-conflict" | "scope-unavailable";
	readonly failure?: RuntimeObservationFailure;
}

export const CODING_AGENT_CONFIGURATION_ISSUE_OBSERVATION =
	defineRuntimeObservation<CodingAgentConfigurationIssueObservation>("coding-agent.configuration", "issue", "warning");
