import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core";

export interface CodingAgentCompactionPrefireObservation {
	readonly phase: "cached" | "failed" | "cancelled";
	readonly tokensBefore?: number;
	readonly failure?: RuntimeObservationFailure;
}

export const CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION =
	defineRuntimeObservation<CodingAgentCompactionPrefireObservation>(
		"coding-agent.context",
		"compaction-prefire",
		"debug",
	);
