import type { AgentRunLimits } from "./types.js";

export function validateAgentRunLimits(limits: AgentRunLimits): void {
	if (limits.maxModelCalls !== undefined) positiveInteger(limits.maxModelCalls, "maxModelCalls");
	if (limits.maxToolCalls !== undefined) positiveInteger(limits.maxToolCalls, "maxToolCalls");
	nonNegativeInteger(limits.maxRecoveryAttempts, "maxRecoveryAttempts");
	positiveInteger(limits.checkpointTimeoutMs, "checkpointTimeoutMs");
	if (limits.deadlineMs !== undefined) positiveInteger(limits.deadlineMs, "deadlineMs");
}

function positiveInteger(value: number, name: keyof AgentRunLimits): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
}

function nonNegativeInteger(value: number, name: keyof AgentRunLimits): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
}
