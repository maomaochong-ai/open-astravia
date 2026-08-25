import { defineRuntimeObservation, type RuntimeAssemblyOperation } from "@vetta/runtime-core";

export type CodingAgentSessionInitializationStage =
	| "ownership"
	| "peripherals"
	| "context"
	| "prompt-runtime"
	| "plugin-skills"
	| "runtime-capabilities"
	| "turn-capabilities"
	| "initial-system-prompt";

export interface CodingAgentSessionInitializationObservation {
	readonly operation: RuntimeAssemblyOperation;
	readonly status: "stage-completed" | "stage-failed" | "completed" | "failed";
	readonly stage?: CodingAgentSessionInitializationStage;
	readonly failedStage?: CodingAgentSessionInitializationStage;
	readonly durationMs: number;
	readonly totalDurationMs: number;
}

/** Coding Agent 自有的安全初始化摘要；身份由 Runtime Observation context 承载。 */
export const CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION =
	defineRuntimeObservation<CodingAgentSessionInitializationObservation>("coding-agent.session", "initialization");
