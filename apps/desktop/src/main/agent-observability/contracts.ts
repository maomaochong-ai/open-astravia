import type { RuntimeTraceRecord } from "@vetta/runtime-telemetry";

export interface AgentObservationQuery {
	readonly sessionId: string;
	readonly turnId?: string;
	readonly traceId?: string;
	readonly errorsOnly?: boolean;
	readonly cursor?: string;
	readonly limit?: number;
}
export interface AgentObservationHealth {
	readonly records: number;
	readonly dropped: number;
	readonly issue: "TRACE_STORAGE_FAILED" | "TRACE_FORMAT_INVALID" | "TRACE_ADAPTER_FAILED" | "TRACE_CAPACITY" | null;
}
export interface AgentObservationPage {
	readonly records: readonly RuntimeTraceRecord[];
	readonly nextCursor: string | null;
	readonly health: AgentObservationHealth;
}
