import type { AgentLoopLimits } from "../types.js";

export const DEFAULT_AGENT_LOOP_LIMITS: Required<AgentLoopLimits> = {
	maxModelCalls: 100,
	maxToolCalls: 1_000,
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

export function resolveAgentLoopLimits(limits: AgentLoopLimits | undefined): Required<AgentLoopLimits> {
	return {
		maxModelCalls: positiveInteger(limits?.maxModelCalls, DEFAULT_AGENT_LOOP_LIMITS.maxModelCalls, "maxModelCalls"),
		maxToolCalls: positiveInteger(limits?.maxToolCalls, DEFAULT_AGENT_LOOP_LIMITS.maxToolCalls, "maxToolCalls"),
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

function positiveInteger(value: number | undefined, fallback: number, name: keyof AgentLoopLimits): number {
	if (value === undefined) return fallback;
	if (Number.isSafeInteger(value) && value > 0) return value;
	throw new RangeError(`Agent loop limit ${name} must be a positive safe integer`);
}
