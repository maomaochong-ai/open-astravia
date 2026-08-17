/** Platform-neutral observation contract consumed by the Agent execution loop. */
export type AgentObservationType = "span" | "generation" | "event" | "agent" | "tool";

export type AgentObservationLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";

export interface AgentUsageDetails {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	[key: string]: number | undefined;
}

export interface AgentCostDetails {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	total?: number;
	[key: string]: number | undefined;
}

export interface AgentObservationUpdate {
	input?: unknown;
	output?: unknown;
	metadata?: Record<string, unknown>;
	level?: AgentObservationLevel;
	statusMessage?: string;
	userId?: string;
	sessionId?: string;
	traceName?: string;
	tags?: string[];
	version?: string;
	model?: string;
	modelParameters?: Record<string, string | number>;
	usageDetails?: AgentUsageDetails;
	costDetails?: AgentCostDetails;
}

export interface AgentObservationStartOptions {
	type?: AgentObservationType;
}

export interface AgentObservation {
	id: string;
	traceId: string;
	type: AgentObservationType;
	startObservation(
		name: string,
		update?: AgentObservationUpdate,
		options?: AgentObservationStartOptions,
	): AgentObservation;
	update(update: AgentObservationUpdate): void;
	end(update?: AgentObservationUpdate): void;
}

/** Implemented by optional telemetry adapters; the Agent core owns no exporter lifecycle. */
export interface AgentTracer {
	startObservation(
		name: string,
		update?: AgentObservationUpdate,
		options?: AgentObservationStartOptions,
	): AgentObservation;
	flush?(): Promise<void>;
	shutdown?(): Promise<void>;
}
