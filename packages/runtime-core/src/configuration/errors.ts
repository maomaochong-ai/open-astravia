export const RUNTIME_CONFIGURATION_ERROR_CODES = {
	CLOSED: "RUNTIME_CONFIGURATION_REGISTRY_CLOSED",
	INVALID_DEFINITION: "RUNTIME_CONFIGURATION_INVALID_DEFINITION",
	INVALID_LAYER: "RUNTIME_CONFIGURATION_INVALID_LAYER",
	LAYER_SOURCE_CONFLICT: "RUNTIME_CONFIGURATION_LAYER_SOURCE_CONFLICT",
	NOT_FOUND: "RUNTIME_CONFIGURATION_NOT_FOUND",
	SOURCE_CONFLICT: "RUNTIME_CONFIGURATION_SOURCE_CONFLICT",
	UNAVAILABLE: "RUNTIME_CONFIGURATION_UNAVAILABLE",
} as const;

export type RuntimeConfigurationErrorCode =
	(typeof RUNTIME_CONFIGURATION_ERROR_CODES)[keyof typeof RUNTIME_CONFIGURATION_ERROR_CODES];

export class RuntimeConfigurationError extends Error {
	readonly code: RuntimeConfigurationErrorCode;

	constructor(code: RuntimeConfigurationErrorCode, message: string) {
		super(message);
		this.name = "RuntimeConfigurationError";
		this.code = code;
	}
}

export function invalidRuntimeConfigurationDefinitionError(message: string): RuntimeConfigurationError {
	return new RuntimeConfigurationError(RUNTIME_CONFIGURATION_ERROR_CODES.INVALID_DEFINITION, message);
}

export function invalidRuntimeConfigurationLayerError(message: string): RuntimeConfigurationError {
	return new RuntimeConfigurationError(RUNTIME_CONFIGURATION_ERROR_CODES.INVALID_LAYER, message);
}

export function runtimeConfigurationRegistryClosedError(): RuntimeConfigurationError {
	return new RuntimeConfigurationError(
		RUNTIME_CONFIGURATION_ERROR_CODES.CLOSED,
		"Runtime Configuration registry is closed",
	);
}

export function runtimeConfigurationNotFoundError(configurationId: string): RuntimeConfigurationError {
	return new RuntimeConfigurationError(
		RUNTIME_CONFIGURATION_ERROR_CODES.NOT_FOUND,
		`Runtime Configuration is not registered: ${configurationId}`,
	);
}

export function runtimeConfigurationUnavailableError(configurationId: string): RuntimeConfigurationError {
	return new RuntimeConfigurationError(
		RUNTIME_CONFIGURATION_ERROR_CODES.UNAVAILABLE,
		`Runtime Configuration is retired: ${configurationId}`,
	);
}

export function runtimeConfigurationSourceConflictError(
	configurationId: string,
	currentSourceId: string,
	nextSourceId: string,
): RuntimeConfigurationError {
	return new RuntimeConfigurationError(
		RUNTIME_CONFIGURATION_ERROR_CODES.SOURCE_CONFLICT,
		`Runtime Configuration ${configurationId} is owned by source ${currentSourceId}, not ${nextSourceId}`,
	);
}

export function runtimeConfigurationLayerSourceConflictError(
	layerId: string,
	currentSourceId: string,
	nextSourceId: string,
): RuntimeConfigurationError {
	return new RuntimeConfigurationError(
		RUNTIME_CONFIGURATION_ERROR_CODES.LAYER_SOURCE_CONFLICT,
		`Runtime Configuration layer ${layerId} is owned by source ${currentSourceId}, not ${nextSourceId}`,
	);
}
