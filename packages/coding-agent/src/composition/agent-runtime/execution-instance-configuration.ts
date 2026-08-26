import type {
	RuntimeAgentSessionPlan,
	RuntimeAgentSessionPreparationContext,
	RuntimeResourceContext,
} from "@vetta/runtime-core";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";

export interface CodingAgentExecutionSessionRequest {
	readonly options: CodingAgentRuntimeSessionOptions;
	readonly resourceContext: RuntimeResourceContext;
}

export interface CodingAgentExecutionRuntimeInstanceConfiguration {
	readonly applicationConfiguration?: unknown;
	prepareSession(
		context: RuntimeAgentSessionPreparationContext,
		request: CodingAgentExecutionSessionRequest,
	): Promise<RuntimeAgentSessionPlan>;
}

export function requireCodingAgentExecutionRuntimeInstanceConfiguration(
	value: unknown,
): CodingAgentExecutionRuntimeInstanceConfiguration {
	if (!value || typeof value !== "object") {
		throw new Error("Coding Agent execution Definition requires an Instance configuration");
	}
	const candidate = value as Partial<CodingAgentExecutionRuntimeInstanceConfiguration>;
	if (typeof candidate.prepareSession !== "function") {
		throw new Error("Coding Agent execution Instance configuration must define prepareSession()");
	}
	return {
		applicationConfiguration: candidate.applicationConfiguration,
		prepareSession: candidate.prepareSession.bind(value),
	};
}

export function requireCodingAgentExecutionSessionRequest(value: unknown): CodingAgentExecutionSessionRequest {
	if (!value || typeof value !== "object") {
		throw new Error("Coding Agent execution Session requires a configuration");
	}
	const candidate = value as Partial<CodingAgentExecutionSessionRequest>;
	if (!candidate.options || typeof candidate.options !== "object") {
		throw new Error("Coding Agent execution Session configuration must include options");
	}
	if (!candidate.resourceContext || typeof candidate.resourceContext !== "object") {
		throw new Error("Coding Agent execution Session configuration must include resourceContext");
	}
	return candidate as CodingAgentExecutionSessionRequest;
}
