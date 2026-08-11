import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, KnownProvider, Model } from "@vetta/ai";
import chalk from "chalk";
import type { CodingAgentModelCatalogView } from "../model-contracts.js";
import { parseModelPattern } from "./model-pattern.js";
import type { ScopedModel } from "./model-scope.js";
import { DEFAULT_MODEL_PER_PROVIDER, DEFAULT_THINKING_LEVEL } from "./model-selection-defaults.js";

type ModelSelectionCatalog = Pick<CodingAgentModelCatalogView, "find" | "getAll" | "getAvailable"> & {
	getApiKey(model: Model<Api>): Promise<string | undefined>;
};

export interface ResolveCliModelResult {
	readonly model: Model<Api> | undefined;
	readonly thinkingLevel?: ThinkingLevel;
	readonly warning: string | undefined;
	readonly error: string | undefined;
}

export function resolveCliModel(options: {
	readonly cliProvider?: string;
	readonly cliModel?: string;
	readonly models: Pick<ModelSelectionCatalog, "getAll">;
}): ResolveCliModelResult {
	const { cliProvider, cliModel, models } = options;
	if (!cliModel) return { model: undefined, warning: undefined, error: undefined };
	const availableModels = models.getAll();
	if (availableModels.length === 0) {
		return {
			model: undefined,
			warning: undefined,
			error: "No models available. Check your installation or add models to models.json.",
		};
	}
	const providerMap = new Map<string, string>();
	for (const model of availableModels) providerMap.set(model.provider.toLowerCase(), model.provider);
	let provider = cliProvider ? providerMap.get(cliProvider.toLowerCase()) : undefined;
	if (cliProvider && !provider) {
		return {
			model: undefined,
			warning: undefined,
			error: `Unknown provider "${cliProvider}". Use --list-models to see available providers/models.`,
		};
	}
	let pattern = cliModel;
	let inferredProvider = false;
	if (!provider) {
		const slashIndex = cliModel.indexOf("/");
		if (slashIndex !== -1) {
			const canonical = providerMap.get(cliModel.substring(0, slashIndex).toLowerCase());
			if (canonical) {
				provider = canonical;
				pattern = cliModel.substring(slashIndex + 1);
				inferredProvider = true;
			}
		}
	}
	if (!provider) {
		const exact = findExactModel(cliModel, availableModels);
		if (exact) return { model: exact, warning: undefined, thinkingLevel: undefined, error: undefined };
	}
	if (cliProvider && provider) {
		const prefix = `${provider}/`;
		if (cliModel.toLowerCase().startsWith(prefix.toLowerCase())) pattern = cliModel.substring(prefix.length);
	}
	const candidates = provider ? availableModels.filter((model) => model.provider === provider) : availableModels;
	const result = parseModelPattern(pattern, candidates, { allowInvalidThinkingLevelFallback: false });
	if (result.model) return { ...result, error: undefined };
	if (inferredProvider) {
		const exact = findExactModel(cliModel, availableModels);
		if (exact) return { model: exact, warning: undefined, thinkingLevel: undefined, error: undefined };
		const fallback = parseModelPattern(cliModel, availableModels, { allowInvalidThinkingLevelFallback: false });
		if (fallback.model) return { ...fallback, error: undefined };
	}
	const display = provider ? `${provider}/${pattern}` : cliModel;
	return {
		model: undefined,
		thinkingLevel: undefined,
		warning: result.warning,
		error: `Model "${display}" not found. Use --list-models to see available models.`,
	};
}

export interface InitialModelResult {
	readonly model: Model<Api> | undefined;
	readonly thinkingLevel: ThinkingLevel;
	readonly fallbackMessage: string | undefined;
}

export async function findInitialModel(options: {
	readonly cliProvider?: string;
	readonly cliModel?: string;
	readonly scopedModels: readonly ScopedModel[];
	readonly isContinuing: boolean;
	readonly defaultProvider?: string;
	readonly defaultModelId?: string;
	readonly defaultThinkingLevel?: ThinkingLevel;
	readonly models: Pick<ModelSelectionCatalog, "find" | "getAvailable">;
}): Promise<InitialModelResult> {
	const { models } = options;
	if (options.cliProvider && options.cliModel) {
		const found = models.find(options.cliProvider, options.cliModel);
		if (!found) {
			console.error(chalk.red(`Model ${options.cliProvider}/${options.cliModel} not found`));
			process.exit(1);
		}
		return { model: found, thinkingLevel: DEFAULT_THINKING_LEVEL, fallbackMessage: undefined };
	}
	if (options.scopedModels.length > 0 && !options.isContinuing) {
		return {
			model: options.scopedModels[0].model,
			thinkingLevel: options.scopedModels[0].thinkingLevel ?? options.defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL,
			fallbackMessage: undefined,
		};
	}
	if (options.defaultProvider && options.defaultModelId) {
		const found = models.find(options.defaultProvider, options.defaultModelId);
		if (found) {
			return {
				model: found,
				thinkingLevel: options.defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL,
				fallbackMessage: undefined,
			};
		}
	}
	const available = await models.getAvailable();
	return {
		model: findPreferredModel(available),
		thinkingLevel: DEFAULT_THINKING_LEVEL,
		fallbackMessage: undefined,
	};
}

export async function restoreModelFromSession(
	savedProvider: string,
	savedModelId: string,
	currentModel: Model<Api> | undefined,
	shouldPrintMessages: boolean,
	models: ModelSelectionCatalog,
): Promise<{ model: Model<Api> | undefined; fallbackMessage: string | undefined }> {
	const restored = models.find(savedProvider, savedModelId);
	const hasApiKey = restored ? !!(await models.getApiKey(restored)) : false;
	if (restored && hasApiKey) {
		if (shouldPrintMessages) console.log(chalk.dim(`Restored model: ${savedProvider}/${savedModelId}`));
		return { model: restored, fallbackMessage: undefined };
	}
	const reason = !restored ? "model no longer exists" : "no API key available";
	if (shouldPrintMessages) {
		console.error(chalk.yellow(`Warning: Could not restore model ${savedProvider}/${savedModelId} (${reason}).`));
	}
	const fallback = currentModel ?? findPreferredModel(await models.getAvailable());
	if (!fallback) return { model: undefined, fallbackMessage: undefined };
	if (shouldPrintMessages) console.log(chalk.dim(`Falling back to: ${fallback.provider}/${fallback.id}`));
	return {
		model: fallback,
		fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${fallback.provider}/${fallback.id}.`,
	};
}

function findExactModel(pattern: string, models: readonly Model<Api>[]): Model<Api> | undefined {
	const lower = pattern.toLowerCase();
	return models.find(
		(model) => model.id.toLowerCase() === lower || `${model.provider}/${model.id}`.toLowerCase() === lower,
	);
}

function findPreferredModel(models: readonly Model<Api>[]): Model<Api> | undefined {
	for (const provider of Object.keys(DEFAULT_MODEL_PER_PROVIDER) as KnownProvider[]) {
		const match = models.find(
			(model) => model.provider === provider && model.id === DEFAULT_MODEL_PER_PROVIDER[provider],
		);
		if (match) return match;
	}
	return models[0];
}
