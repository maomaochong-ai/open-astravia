import type { RuntimeAssemblyOperation } from "@vetta/runtime-core";

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
	readonly sessionId: string;
	readonly operation: RuntimeAssemblyOperation;
	readonly status: "stage-completed" | "stage-failed" | "completed" | "failed";
	readonly stage?: CodingAgentSessionInitializationStage;
	readonly failedStage?: CodingAgentSessionInitializationStage;
	readonly durationMs: number;
	readonly totalDurationMs: number;
}

export type CodingAgentSessionInitializationObserver = (
	observation: CodingAgentSessionInitializationObservation,
) => void;
