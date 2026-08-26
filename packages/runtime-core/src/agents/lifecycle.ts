import { RUNTIME_AGENT_ERROR_CODES, RuntimeAgentError } from "./errors.js";

export async function cleanupRuntimeAgentResources(
	tasks: readonly (() => Promise<void> | void | undefined)[],
	primaryError: unknown,
	message: string,
): Promise<void> {
	const errors: unknown[] = [];
	for (const task of tasks) {
		try {
			await task();
		} catch (error) {
			errors.push(error);
		}
	}
	if (primaryError !== undefined && errors.length > 0) throw new AggregateError([primaryError, ...errors], message);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, message);
}

export function runtimeAgentDuplicateIdError(kind: "Instance" | "Session", id: string): RuntimeAgentError {
	return new RuntimeAgentError(
		RUNTIME_AGENT_ERROR_CODES.DUPLICATE_ID,
		`Runtime Agent ${kind} id is already registered: ${id}`,
	);
}

export function runtimeAgentInstanceNotFoundError(instanceId: string): RuntimeAgentError {
	return new RuntimeAgentError(
		RUNTIME_AGENT_ERROR_CODES.INSTANCE_NOT_FOUND,
		`Runtime Agent Instance is not registered: ${instanceId}`,
	);
}

export function compareRuntimeAgentId(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
