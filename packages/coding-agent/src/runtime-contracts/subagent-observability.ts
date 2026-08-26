import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core";

export type CodingAgentSubagentIssueOperation =
	| "coordinator"
	| "recovery"
	| "notification-delivery"
	| "session-observation";

export interface CodingAgentSubagentIssueObservation {
	readonly operation: CodingAgentSubagentIssueOperation;
	readonly failure: RuntimeObservationFailure;
}

export const CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION = defineRuntimeObservation<CodingAgentSubagentIssueObservation>(
	"coding-agent.subagent",
	"issue",
	"warning",
);
