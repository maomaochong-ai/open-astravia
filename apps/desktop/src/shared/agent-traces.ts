import type { RuntimeTraceRecord } from "@vetta/runtime-telemetry";

export interface AgentTraceQuery {
	readonly sessionId: string;
	readonly turnId?: string;
	readonly traceId?: string;
	readonly errorsOnly?: boolean;
	readonly cursor?: string;
	readonly limit?: number;
}
export interface AgentTraceHealth {
	readonly records: number;
	readonly dropped: number;
	readonly issue: "TRACE_STORAGE_FAILED" | "TRACE_FORMAT_INVALID" | "TRACE_ADAPTER_FAILED" | "TRACE_CAPACITY" | null;
}
export interface AgentTracePage {
	readonly records: readonly RuntimeTraceRecord[];
	readonly nextCursor: string | null;
	readonly health: AgentTraceHealth;
}
export interface DesktopAgentTracesApi {
	query(request: AgentTraceQuery): Promise<AgentTracePage>;
}
export const AGENT_TRACES_QUERY_CHANNEL = "agent-traces:query";
