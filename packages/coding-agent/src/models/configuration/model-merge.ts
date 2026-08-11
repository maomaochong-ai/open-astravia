import type { Api, Model, OpenAICompletionsCompat, OpenAIResponsesCompat } from "@vetta/ai";
import { resolveConfigHeaders } from "../../configuration/config-value-resolver.js";
import type { ModelOverride } from "./model-config-schema.js";

export interface ProviderOverride {
	readonly baseUrl?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly apiKey?: string;
}

export function mergeModels(base: readonly Model<Api>[], additions: readonly Model<Api>[]): Model<Api>[] {
	const merged = [...base];
	for (const addition of additions) {
		const index = merged.findIndex((model) => model.provider === addition.provider && model.id === addition.id);
		if (index >= 0) merged[index] = addition;
		else merged.push(addition);
	}
	return merged;
}

export function applyProviderAndModelOverrides(
	models: readonly Model<Api>[],
	providerOverride: ProviderOverride | undefined,
	modelOverrides: ReadonlyMap<string, ModelOverride> | undefined,
): Model<Api>[] {
	return models.map((source) => {
		let model = source;
		if (providerOverride) {
			const headers = resolveConfigHeaders(providerOverride.headers);
			model = {
				...model,
				baseUrl: providerOverride.baseUrl ?? model.baseUrl,
				headers: headers ? { ...model.headers, ...headers } : model.headers,
			};
		}
		const override = modelOverrides?.get(source.id);
		return override ? applyModelOverride(model, override) : model;
	});
}

export function mergeCompat(
	baseCompat: Model<Api>["compat"],
	overrideCompat: ModelOverride["compat"],
): Model<Api>["compat"] | undefined {
	if (!overrideCompat) return baseCompat;

	const base = baseCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | undefined;
	const override = overrideCompat as OpenAICompletionsCompat | OpenAIResponsesCompat;
	const merged = { ...base, ...override } as OpenAICompletionsCompat | OpenAIResponsesCompat;
	const baseCompletions = base as OpenAICompletionsCompat | undefined;
	const overrideCompletions = override as OpenAICompletionsCompat;
	const mergedCompletions = merged as OpenAICompletionsCompat;

	if (baseCompletions?.openRouterRouting || overrideCompletions.openRouterRouting) {
		mergedCompletions.openRouterRouting = {
			...baseCompletions?.openRouterRouting,
			...overrideCompletions.openRouterRouting,
		};
	}
	if (baseCompletions?.vercelGatewayRouting || overrideCompletions.vercelGatewayRouting) {
		mergedCompletions.vercelGatewayRouting = {
			...baseCompletions?.vercelGatewayRouting,
			...overrideCompletions.vercelGatewayRouting,
		};
	}
	return merged as Model<Api>["compat"];
}

function applyModelOverride(model: Model<Api>, override: ModelOverride): Model<Api> {
	const result = { ...model };
	if (override.name !== undefined) result.name = override.name;
	if (override.reasoning !== undefined) result.reasoning = override.reasoning;
	if (override.input !== undefined) result.input = override.input;
	if (override.contextWindow !== undefined) result.contextWindow = override.contextWindow;
	if (override.maxTokens !== undefined) result.maxTokens = override.maxTokens;
	if (override.cost) {
		result.cost = {
			input: override.cost.input ?? model.cost.input,
			output: override.cost.output ?? model.cost.output,
			cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
			cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
		};
	}
	if (override.headers) {
		const headers = resolveConfigHeaders(override.headers);
		result.headers = headers ? { ...model.headers, ...headers } : model.headers;
	}
	result.compat = mergeCompat(model.compat, override.compat);
	return result;
}
