import type { SessionEndCause } from "@vetta/ecosystem-adapter";
import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core";

export interface CodingAgentLifecycleIssueObservation {
	readonly operation: "session-end-hook";
	readonly cause: SessionEndCause;
	readonly failure: RuntimeObservationFailure;
}

export const CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION = defineRuntimeObservation<CodingAgentLifecycleIssueObservation>(
	"coding-agent.lifecycle",
	"issue",
	"warning",
);
