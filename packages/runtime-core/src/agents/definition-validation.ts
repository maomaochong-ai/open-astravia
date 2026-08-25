import type { RuntimeObservationPublisher } from "../observation/index.js";
import type { SessionExtensionComposition } from "../session-extensions/index.js";
import type { RuntimeAgentInstanceDefinition, RuntimeAgentSessionDefinition } from "./contracts.js";
import { RUNTIME_AGENT_HOST_ERROR_CODES, RuntimeAgentHostError } from "./errors.js";
import { compareRuntimeAgentId } from "./lifecycle.js";

export function normalizeRuntimeAgentInstanceDefinition(value: unknown): RuntimeAgentInstanceDefinition {
	if (!value || typeof value !== "object" || !("createSession" in value)) {
		throw invalidInstanceError("Runtime Agent Instance definition must define createSession()");
	}
	const candidate = value as Partial<RuntimeAgentInstanceDefinition>;
	if (typeof candidate.createSession !== "function") {
		throw invalidInstanceError("Runtime Agent Instance createSession must be a function");
	}
	if (candidate.dispose !== undefined && typeof candidate.dispose !== "function") {
		throw invalidInstanceError("Runtime Agent Instance dispose must be a function");
	}
	const createSession = candidate.createSession.bind(value);
	const dispose = candidate.dispose?.bind(value);
	return Object.freeze({ createSession, ...(dispose ? { dispose } : {}) });
}

export function normalizeRuntimeAgentSessionDefinition(value: unknown): RuntimeAgentSessionDefinition {
	if (!value || typeof value !== "object" || !("capabilities" in value)) {
		throw invalidInstanceError("Runtime Agent Session definition must provide capabilities");
	}
	const candidate = value as Partial<RuntimeAgentSessionDefinition>;
	assertCapabilityDefinition(candidate.capabilities);
	if (candidate.modelBindingProvider !== undefined && typeof candidate.modelBindingProvider.bind !== "function") {
		throw invalidInstanceError("Runtime Agent Session modelBindingProvider must define bind()");
	}
	if (candidate.sessionExtensions !== undefined && !Array.isArray(candidate.sessionExtensions)) {
		throw invalidInstanceError("Runtime Agent Session extensions must be an array");
	}
	if (candidate.dispose !== undefined && typeof candidate.dispose !== "function") {
		throw invalidInstanceError("Runtime Agent Session dispose must be a function");
	}
	const dispose = candidate.dispose?.bind(value);
	return Object.freeze({
		capabilities: candidate.capabilities,
		modelBindingProvider: candidate.modelBindingProvider,
		sessionExtensions: candidate.sessionExtensions ? Object.freeze([...candidate.sessionExtensions]) : undefined,
		...(dispose ? { dispose } : {}),
	});
}

export function withRuntimeAgentExtensionFeatures(
	capabilities: RuntimeAgentSessionDefinition["capabilities"],
	extensionFeatures: SessionExtensionComposition["features"],
): RuntimeAgentSessionDefinition["capabilities"] {
	return {
		...capabilities,
		features: Object.freeze([...capabilities.features, ...extensionFeatures]),
	};
}

export function withRuntimeAgentObservationPublisher(
	capabilities: RuntimeAgentSessionDefinition["capabilities"],
	publisher: RuntimeObservationPublisher,
): RuntimeAgentSessionDefinition["capabilities"] {
	return { ...capabilities, observationPublisher: publisher };
}

export function runtimeAgentExtensionIds(definition: RuntimeAgentSessionDefinition): readonly string[] {
	return Object.freeze((definition.sessionExtensions ?? []).map(({ id }) => id).sort(compareRuntimeAgentId));
}

export function assertSameRuntimeAgentExtensionTopology(
	sessionId: string,
	current: readonly string[],
	next: readonly string[],
): void {
	if (current.length === next.length && current.every((id, index) => id === next[index])) return;
	throw new RuntimeAgentHostError(
		RUNTIME_AGENT_HOST_ERROR_CODES.ROLLOUT_EXTENSION_TOPOLOGY,
		`Runtime Agent Session rollout cannot change Session Extension topology: ${sessionId}`,
	);
}

function assertCapabilityDefinition(
	value: RuntimeAgentSessionDefinition["capabilities"] | undefined,
): asserts value is RuntimeAgentSessionDefinition["capabilities"] {
	if (!value || typeof value !== "object") {
		throw invalidInstanceError("Runtime Agent Session capabilities must be an object");
	}
	if (!Array.isArray(value.instructions) || !Array.isArray(value.features)) {
		throw invalidInstanceError("Runtime Agent Session capabilities must provide instruction and feature arrays");
	}
	if (!value.contextStrategy || typeof value.contextStrategy.prepare !== "function") {
		throw invalidInstanceError("Runtime Agent Session capabilities must provide a Context Strategy");
	}
	if (!value.toolPolicy || typeof value.toolPolicy.authorize !== "function") {
		throw invalidInstanceError("Runtime Agent Session capabilities must provide a Tool Policy");
	}
	if (!Number.isFinite(value.tokenBudget) || !Number.isFinite(value.reservedOutputTokens)) {
		throw invalidInstanceError("Runtime Agent Session token budgets must be finite numbers");
	}
}

function invalidInstanceError(message: string): RuntimeAgentHostError {
	return new RuntimeAgentHostError(RUNTIME_AGENT_HOST_ERROR_CODES.INVALID_INSTANCE, message);
}
