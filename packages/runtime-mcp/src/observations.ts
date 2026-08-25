import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core";

export interface McpRuntimeObservation {
	readonly operation: "tool.sync" | "tool.dispose";
	readonly phase: "started" | "completed" | "failed";
	readonly revision?: number;
	readonly toolCount?: number;
	readonly changed?: boolean;
	readonly failure?: RuntimeObservationFailure;
}

export const MCP_RUNTIME_OBSERVATION = defineRuntimeObservation<McpRuntimeObservation>("runtime.mcp", "lifecycle");
