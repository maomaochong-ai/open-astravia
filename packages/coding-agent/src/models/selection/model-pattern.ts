import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import { isValidThinkingLevel } from "./model-selection-defaults.js";

export interface ParsedModelResult {
	readonly model: Model<Api> | undefined;
	readonly thinkingLevel?: ThinkingLevel;
	readonly warning: string | undefined;
}

export function parseModelPattern(
	pattern: string,
	availableModels: readonly Model<Api>[],
	options?: { readonly allowInvalidThinkingLevelFallback?: boolean },
): ParsedModelResult {
	const exactMatch = tryMatchModel(pattern, availableModels);
	if (exactMatch) return { model: exactMatch, thinkingLevel: undefined, warning: undefined };

	const lastColonIndex = pattern.lastIndexOf(":");
	if (lastColonIndex === -1) return { model: undefined, thinkingLevel: undefined, warning: undefined };
	const prefix = pattern.substring(0, lastColonIndex);
	const suffix = pattern.substring(lastColonIndex + 1);
	if (isValidThinkingLevel(suffix)) {
		const result = parseModelPattern(prefix, availableModels, options);
		return result.model
			? { model: result.model, thinkingLevel: result.warning ? undefined : suffix, warning: result.warning }
			: result;
	}
	if (!(options?.allowInvalidThinkingLevelFallback ?? true)) {
		return { model: undefined, thinkingLevel: undefined, warning: undefined };
	}
	const result = parseModelPattern(prefix, availableModels, options);
	return result.model
		? {
				model: result.model,
				thinkingLevel: undefined,
				warning: `Invalid thinking level "${suffix}" in pattern "${pattern}". Using default instead.`,
			}
		: result;
}

function tryMatchModel(pattern: string, models: readonly Model<Api>[]): Model<Api> | undefined {
	const slashIndex = pattern.indexOf("/");
	if (slashIndex !== -1) {
		const provider = pattern.substring(0, slashIndex);
		const modelId = pattern.substring(slashIndex + 1);
		const match = models.find(
			(model) =>
				model.provider.toLowerCase() === provider.toLowerCase() && model.id.toLowerCase() === modelId.toLowerCase(),
		);
		if (match) return match;
	}
	const exact = models.find((model) => model.id.toLowerCase() === pattern.toLowerCase());
	if (exact) return exact;
	const partial = models.filter(
		(model) =>
			model.id.toLowerCase().includes(pattern.toLowerCase()) ||
			model.name?.toLowerCase().includes(pattern.toLowerCase()),
	);
	if (partial.length === 0) return undefined;
	const aliases = partial.filter((model) => isAlias(model.id));
	const candidates = aliases.length > 0 ? aliases : partial.filter((model) => !isAlias(model.id));
	return candidates.sort((left, right) => right.id.localeCompare(left.id))[0];
}

function isAlias(id: string): boolean {
	return id.endsWith("-latest") || !/-\d{8}$/.test(id);
}
