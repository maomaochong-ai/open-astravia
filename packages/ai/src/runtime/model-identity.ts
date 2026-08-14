import type { ModelCapabilities, ModelLimits } from "../protocol/model-capabilities.js";
import type { Api, Model, Provider } from "../types.js";
import { resolveModelCapabilities } from "./model-capabilities.js";

export interface ModelIdentity {
	readonly modelId: string;
	readonly provider: Provider;
	readonly api: Api;
}

export interface ModelEndpoint {
	readonly baseUrl: string;
	readonly gatewayUrl?: string;
	readonly headers?: Readonly<Record<string, string>>;
}

export interface ResolvedModel {
	readonly identity: ModelIdentity;
	readonly endpoint: ModelEndpoint;
	readonly capabilities: ModelCapabilities;
	readonly limits: ModelLimits;
}

export function resolveModel(model: Model<Api>): ResolvedModel {
	return {
		identity: { modelId: model.id, provider: model.provider, api: model.api },
		endpoint: { baseUrl: model.baseUrl, gatewayUrl: model.gatewayUrl, headers: model.headers },
		capabilities: resolveModelCapabilities(model),
		limits: { contextWindow: model.contextWindow, maxTokens: model.maxTokens },
	};
}
