import type { SessionEndCause } from "@astravia/ecosystem-adapter";
import { defineRuntimeObservation, type RuntimeObservationFailure } from "@astravia/runtime-core";

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
