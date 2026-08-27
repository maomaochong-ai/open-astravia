import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core/observation";

export interface CodingAgentSessionAssistanceObservation {
	readonly operation: "title.generate" | "next-prompts.generate";
	readonly phase: "started" | "candidate-empty" | "candidate-failed" | "completed" | "exhausted";
	readonly modelProvider?: string;
	readonly modelId?: string;
	readonly attempt?: number;
	readonly durationMs?: number;
	readonly resultCount?: number;
	readonly failure?: RuntimeObservationFailure;
}

export const CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION =
	defineRuntimeObservation<CodingAgentSessionAssistanceObservation>("coding-agent.session-assistance", "lifecycle");
