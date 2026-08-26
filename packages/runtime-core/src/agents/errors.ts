export const RUNTIME_AGENT_REGISTRY_ERROR_CODES = {
	CLOSED: "RUNTIME_AGENT_REGISTRY_CLOSED",
	INVALID_DEFINITION: "RUNTIME_AGENT_INVALID_DEFINITION",
	NOT_FOUND: "RUNTIME_AGENT_NOT_FOUND",
	SOURCE_CONFLICT: "RUNTIME_AGENT_SOURCE_CONFLICT",
	UNAVAILABLE: "RUNTIME_AGENT_UNAVAILABLE",
} as const;

export type RuntimeAgentRegistryErrorCode =
	(typeof RUNTIME_AGENT_REGISTRY_ERROR_CODES)[keyof typeof RUNTIME_AGENT_REGISTRY_ERROR_CODES];

export class RuntimeAgentRegistryError extends Error {
	readonly code: RuntimeAgentRegistryErrorCode;

	constructor(code: RuntimeAgentRegistryErrorCode, message: string) {
		super(message);
		this.name = "RuntimeAgentRegistryError";
		this.code = code;
	}
}

export const RUNTIME_AGENT_ERROR_CODES = {
	CLOSED: "RUNTIME_AGENT_HOST_CLOSED",
	DUPLICATE_ID: "RUNTIME_AGENT_DUPLICATE_ID",
	INSTANCE_NOT_FOUND: "RUNTIME_AGENT_INSTANCE_NOT_FOUND",
	INVALID_INSTANCE: "RUNTIME_AGENT_INVALID_INSTANCE",
	ROLLOUT_EXTENSION_TOPOLOGY: "RUNTIME_AGENT_ROLLOUT_EXTENSION_TOPOLOGY",
	SESSION_NOT_FOUND: "RUNTIME_AGENT_SESSION_NOT_FOUND",
} as const;

export type RuntimeAgentErrorCode = (typeof RUNTIME_AGENT_ERROR_CODES)[keyof typeof RUNTIME_AGENT_ERROR_CODES];

export class RuntimeAgentError extends Error {
	readonly code: RuntimeAgentErrorCode;

	constructor(code: RuntimeAgentErrorCode, message: string) {
		super(message);
		this.name = "RuntimeAgentError";
		this.code = code;
	}
}

export function invalidRuntimeAgentDefinitionError(message: string): RuntimeAgentRegistryError {
	return new RuntimeAgentRegistryError(RUNTIME_AGENT_REGISTRY_ERROR_CODES.INVALID_DEFINITION, message);
}

export function runtimeAgentRegistryClosedError(): RuntimeAgentRegistryError {
	return new RuntimeAgentRegistryError(RUNTIME_AGENT_REGISTRY_ERROR_CODES.CLOSED, "Runtime Agent registry is closed");
}

export function runtimeAgentNotFoundError(agentId: string): RuntimeAgentRegistryError {
	return new RuntimeAgentRegistryError(
		RUNTIME_AGENT_REGISTRY_ERROR_CODES.NOT_FOUND,
		`Runtime Agent is not registered: ${agentId}`,
	);
}

export function runtimeAgentUnavailableError(agentId: string): RuntimeAgentRegistryError {
	return new RuntimeAgentRegistryError(
		RUNTIME_AGENT_REGISTRY_ERROR_CODES.UNAVAILABLE,
		`Runtime Agent is retired: ${agentId}`,
	);
}

export function runtimeAgentSourceConflictError(
	agentId: string,
	currentSourceId: string,
	nextSourceId: string,
): RuntimeAgentRegistryError {
	return new RuntimeAgentRegistryError(
		RUNTIME_AGENT_REGISTRY_ERROR_CODES.SOURCE_CONFLICT,
		`Runtime Agent ${agentId} is owned by source ${currentSourceId}, not ${nextSourceId}`,
	);
}
