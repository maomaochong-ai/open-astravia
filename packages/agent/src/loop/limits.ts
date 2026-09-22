import type { AgentLoopLimits } from "../types.js";

export interface ResolvedAgentLoopLimits {
	readonly maxModelCalls?: number;
	readonly maxToolCalls?: number;
	readonly contextCheckpointTimeoutMs: number;
}

export const DEFAULT_AGENT_LOOP_LIMITS: ResolvedAgentLoopLimits = {
	contextCheckpointTimeoutMs: 300_000,
};

export type AgentLoopLimitKind = "model_calls" | "tool_calls";

export class AgentLoopLimitError extends Error {
	readonly code = "AGENT_LOOP_LIMIT_EXCEEDED";

	constructor(
		readonly kind: AgentLoopLimitKind,
		readonly limit: number,
		readonly observed: number,
	) {
		super(`Agent loop ${kind} limit exceeded: ${observed} > ${limit}`);
		this.name = "AgentLoopLimitError";
	}
}

export function resolveAgentLoopLimits(limits: AgentLoopLimits | undefined): ResolvedAgentLoopLimits {
	const maxModelCalls = optionalPositiveInteger(limits?.maxModelCalls, "maxModelCalls");
	const maxToolCalls = optionalPositiveInteger(limits?.maxToolCalls, "maxToolCalls");
	return {
		...(maxModelCalls === undefined ? {} : { maxModelCalls }),
		...(maxToolCalls === undefined ? {} : { maxToolCalls }),
		contextCheckpointTimeoutMs: positiveInteger(
			limits?.contextCheckpointTimeoutMs,
			DEFAULT_AGENT_LOOP_LIMITS.contextCheckpointTimeoutMs,
			"contextCheckpointTimeoutMs",
		),
	};
}

export function assertWithinAgentLoopLimit(kind: AgentLoopLimitKind, observed: number, limit: number): void {
	if (observed > limit) throw new AgentLoopLimitError(kind, limit, observed);
}

function optionalPositiveInteger(value: number | undefined, name: keyof AgentLoopLimits): number | undefined {
	if (value === undefined) return undefined;
	if (Number.isSafeInteger(value) && value > 0) return value;
	throw new RangeError(`Agent loop limit ${name} must be a positive safe integer`);
}

function positiveInteger(value: number | undefined, fallback: number, name: keyof AgentLoopLimits): number {
	if (value === undefined) return fallback;
	if (Number.isSafeInteger(value) && value > 0) return value;
	throw new RangeError(`Agent loop limit ${name} must be a positive safe integer`);
}
