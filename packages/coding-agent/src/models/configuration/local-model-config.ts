import { existsSync, readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import type { Api, Model } from "@vetta/ai";
import { resolveConfigHeaders, resolveConfigValue } from "../../configuration/config-value-resolver.js";
import { type ModelOverride, type ModelsConfig, ModelsConfigSchema } from "./model-config-schema.js";
import { mergeCompat, type ProviderOverride } from "./model-merge.js";

export interface LocalModelConfigResult {
	readonly models: readonly Model<Api>[];
	readonly overrides: ReadonlyMap<string, ProviderOverride>;
	readonly modelOverrides: ReadonlyMap<string, ReadonlyMap<string, ModelOverride>>;
	readonly apiKeys: ReadonlyMap<string, string>;
	readonly providerNames: ReadonlySet<string>;
	readonly error: string | undefined;
}

export interface ModelConfigFileSource {
	exists(path: string): boolean;
	read(path: string): string;
}

const nodeModelConfigFileSource: ModelConfigFileSource = {
	exists: existsSync,
	read: (path) => readFileSync(path, "utf-8"),
};

const API_TYPE_ALIASES: Readonly<Record<string, string>> = {
	anthropic: "anthropic-messages",
	openai: "openai-completions",
};

export function loadLocalModelConfig(
	path: string | undefined,
	fileSource: ModelConfigFileSource = nodeModelConfigFileSource,
): LocalModelConfigResult {
	if (!path || !fileSource.exists(path)) return emptyResult();
	try {
		const parsed: unknown = JSON.parse(fileSource.read(path));
		stripRetiredFields(parsed);
		if (!Value.Check(ModelsConfigSchema, parsed)) {
			const errors = [...Value.Errors(ModelsConfigSchema, parsed)]
				.map((error) => `  - ${error.path || "root"}: ${error.message}`)
				.join("\n");
			return emptyResult(`Invalid models.json schema:\n${errors || "Unknown schema error"}\n\nFile: ${path}`);
		}

		const config = parsed as ModelsConfig;
		const validation = validateProviders(config);
		const providers = Object.fromEntries(
			Object.entries(config.providers).filter(([name]) => !validation.skip.has(name)),
		);
		const validConfig: ModelsConfig = { ...config, providers };
		const overrides = new Map<string, ProviderOverride>();
		const modelOverrides = new Map<string, ReadonlyMap<string, ModelOverride>>();
		const apiKeys = new Map<string, string>();
		for (const [providerName, provider] of Object.entries(validConfig.providers)) {
			if (provider.baseUrl || provider.headers || provider.apiKey) {
				overrides.set(providerName, {
					baseUrl: provider.baseUrl,
					headers: provider.headers,
					apiKey: provider.apiKey,
				});
			}
			if (provider.apiKey) apiKeys.set(providerName, provider.apiKey);
			if (provider.modelOverrides) {
				modelOverrides.set(providerName, new Map(Object.entries(provider.modelOverrides)));
			}
		}
		const error =
			validation.errors.length > 0
				? `Some providers in models.json were skipped:\n${validation.errors.map((issue) => `  - ${issue}`).join("\n")}\n\nFile: ${path}`
				: undefined;
		const parsedModels = parseModels(validConfig);
		return {
			models: parsedModels.models,
			overrides,
			modelOverrides,
			apiKeys,
			providerNames: parsedModels.providerNames,
			error,
		};
	} catch (error) {
		if (error instanceof SyntaxError) {
			return emptyResult(`Failed to parse models.json: ${error.message}\n\nFile: ${path}`);
		}
		return emptyResult(
			`Failed to load models.json: ${error instanceof Error ? error.message : String(error)}\n\nFile: ${path}`,
		);
	}
}

function parseModels(config: ModelsConfig): { models: Model<Api>[]; providerNames: Set<string> } {
	const models: Model<Api>[] = [];
	const providerNames = new Set<string>();
	for (const [providerName, provider] of Object.entries(config.providers)) {
		const definitions = provider.models ?? [];
		if (definitions.length === 0) continue;
		providerNames.add(providerName);
		for (const definition of definitions) {
			const rawApi = definition.api || provider.api;
			if (!rawApi) continue;
			const providerHeaders = resolveConfigHeaders(provider.headers);
			const modelHeaders = resolveConfigHeaders(definition.headers);
			let headers = providerHeaders || modelHeaders ? { ...providerHeaders, ...modelHeaders } : undefined;
			if (provider.authHeader && provider.apiKey) {
				const key = resolveConfigValue(provider.apiKey);
				if (key) headers = { ...headers, Authorization: `Bearer ${key}` };
			}
			models.push({
				id: definition.id,
				name: definition.name ?? definition.id,
				api: (API_TYPE_ALIASES[rawApi] ?? rawApi) as Api,
				provider: providerName,
				baseUrl: provider.baseUrl as string,
				reasoning: definition.reasoning ?? false,
				input: definition.input ?? ["text"],
				cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: definition.contextWindow ?? 128_000,
				maxTokens: definition.maxTokens ?? 16_384,
				headers,
				compat: mergeCompat(provider.compat, definition.compat),
			});
		}
	}
	return { models, providerNames };
}

function validateProviders(config: ModelsConfig): { skip: Set<string>; errors: string[] } {
	const skip = new Set<string>();
	const errors: string[] = [];
	for (const [name, provider] of Object.entries(config.providers)) {
		try {
			validateProvider(name, provider);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
			skip.add(name);
		}
	}
	return { skip, errors };
}

function validateProvider(name: string, provider: ModelsConfig["providers"][string]): void {
	const models = provider.models ?? [];
	const hasModelOverrides = provider.modelOverrides && Object.keys(provider.modelOverrides).length > 0;
	if (models.length === 0 && !provider.baseUrl && !hasModelOverrides) {
		throw new Error(`Provider ${name}: must specify "baseUrl", "modelOverrides", or "models".`);
	}
	if (models.length > 0 && !provider.baseUrl) {
		throw new Error(`Provider ${name}: "baseUrl" is required when defining custom models.`);
	}
	for (const model of models) {
		if (!provider.api && !model.api) {
			throw new Error(`Provider ${name}, model ${model.id}: no "api" specified. Set at provider or model level.`);
		}
		if (!model.id) throw new Error(`Provider ${name}: model missing "id"`);
		if (model.contextWindow !== undefined && model.contextWindow <= 0) {
			throw new Error(`Provider ${name}, model ${model.id}: invalid contextWindow`);
		}
		if (model.maxTokens !== undefined && model.maxTokens <= 0) {
			throw new Error(`Provider ${name}, model ${model.id}: invalid maxTokens`);
		}
	}
}

function stripRetiredFields(value: unknown): void {
	if (!value || typeof value !== "object") return;
	const record = value as Record<string, unknown>;
	delete record.peripheralModel;
	delete record.peripheralModelReasoningLevel;
}

function emptyResult(error?: string): LocalModelConfigResult {
	return {
		models: [],
		overrides: new Map(),
		modelOverrides: new Map(),
		apiKeys: new Map(),
		providerNames: new Set(),
		error,
	};
}
