import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core";

export interface McpProtocolObservation {
	readonly operation: "negotiation" | "request" | "mrtr" | "task" | "app";
	readonly phase: "started" | "completed" | "failed" | "fallback";
	readonly serverName?: string;
	readonly transport?: "http" | "stdio";
	readonly era?: "legacy" | "modern";
	readonly protocolVersion?: string;
	readonly methodCategory?: "discover" | "initialize" | "tools" | "resources" | "prompts" | "tasks" | "apps" | "other";
	readonly round?: number;
	readonly count?: number;
	readonly durationMs?: number;
	readonly error?: RuntimeObservationFailure;
}

export const MCP_PROTOCOL_OBSERVATION = defineRuntimeObservation<McpProtocolObservation>("runtime.mcp", "protocol");
