import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type {
	ModelConfigSnapshot,
	ModelDefaultResult,
	ModelDefinitionDetail,
	ModelListResult,
	ModelProviderConfigSnapshot,
	ModelProviderDetail,
	ModelProviderUpsertData,
} from "@vetta/capability-sdk";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import type { ModelCredentialStore } from "./model-credential-store.js";

export interface ModelsConfig {
	defaultModel?: string;
	providers: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
	baseUrl?: string;
	apiKey?: string;
	/** Opaque reference to an API key held by the desktop credential vault. */
	credentialRef?: string;
	api?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
	displayName?: string;
	source?: "template";
	templateId?: string;
	icon?: string;
	/** 预设服务商模型列表最近一次从上游 /models 同步的时间(ISO)。 */
	modelsSyncedAt?: string;
	models?: ModelDefinition[];
	modelOverrides?: Record<string, Record<string, unknown>>;
}

export interface ModelDefinition {
	id: string;
	modelId?: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	reasoningLevels?: string[];
	defaultReasoningLevel?: string;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface ModelSettingsServiceOptions {
	readonly readConfig: () => Promise<ModelsConfig>;
	readonly refreshRegistry: () => Promise<void>;
	readonly writeConfig: (config: ModelsConfig) => Promise<void>;
	readonly credentials: ModelCredentialStore;
}

const MODELS_CONFIG_PATH = join(getVettaHomePath(), "agent", "models.json");
const DEFAULT_MODELS_CONFIG: ModelsConfig = { providers: {} };
export const MASKED_MODEL_API_KEY = "***";

function stripLegacyPeripheralFields(config: ModelsConfig): ModelsConfig {
	const next = { ...config } as ModelsConfig & {
		peripheralModel?: unknown;
		peripheralModelReasoningLevel?: unknown;
	};
	delete next.peripheralModel;
	delete next.peripheralModelReasoningLevel;
	return next;
}

export function readModelsConfigSync(): ModelsConfig {
	try {
		const raw = readFileSync(MODELS_CONFIG_PATH, "utf8");
		const parsed = JSON.parse(raw) as Partial<ModelsConfig>;
		return stripLegacyPeripheralFields({
			...DEFAULT_MODELS_CONFIG,
			...parsed,
			providers:
				typeof parsed.providers === "object" && parsed.providers !== null && !Array.isArray(parsed.providers)
					? parsed.providers
					: {},
		});
	} catch {
		return { providers: {} };
	}
}

export async function readModelsConfig(): Promise<ModelsConfig> {
	return readModelsConfigSync();
}

export async function writeModelsConfig(config: ModelsConfig): Promise<void> {
	atomicWriteJSON(MODELS_CONFIG_PATH, stripLegacyPeripheralFields(config));
}

function maskSecret(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) return "";
	return MASKED_MODEL_API_KEY;
}

function redactRecordSecrets(
	record: Record<string, string> | undefined,
	secretKeys: readonly string[] = ["authorization", "api-key", "apikey", "x-api-key", "token", "secret", "password"],
): Record<string, string> | undefined {
	if (!record) return undefined;
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		const lower = key.toLowerCase();
		next[key] = secretKeys.some((secretKey) => lower.includes(secretKey)) ? "***" : value;
	}
	return next;
}

function copyModel(model: ModelDefinition): ModelDefinitionDetail {
	return {
		id: model.id,
		...(model.modelId === undefined ? {} : { modelId: model.modelId }),
		...(model.name === undefined ? {} : { name: model.name }),
		...(model.api === undefined ? {} : { api: model.api }),
		...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
		...(model.reasoningLevels === undefined ? {} : { reasoningLevels: [...model.reasoningLevels] }),
		...(model.defaultReasoningLevel === undefined ? {} : { defaultReasoningLevel: model.defaultReasoningLevel }),
		...(model.input === undefined ? {} : { input: [...model.input] }),
		...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
		...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
		...(model.cost === undefined ? {} : { cost: { ...model.cost } }),
	};
}

function redactProvider(provider: ProviderConfig): ModelProviderConfigSnapshot {
	const apiKey = maskSecret(provider.apiKey);
	const headers = redactRecordSecrets(provider.headers);
	return {
		...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
		...(apiKey === undefined ? {} : { apiKey }),
		...(provider.api === undefined ? {} : { api: provider.api }),
		...(provider.displayName === undefined ? {} : { displayName: provider.displayName }),
		...(provider.authHeader === undefined ? {} : { authHeader: provider.authHeader }),
		...(headers === undefined ? {} : { headers }),
		...(provider.models === undefined ? {} : { models: provider.models.map(copyModel) }),
	};
}

function assertModelKeyExists(config: ModelsConfig, modelKey: string, operation: string): void {
	const slash = modelKey.indexOf("/");
	if (slash <= 0) {
		throw new Error(
			`Refused operation "${operation}": invalid modelKey=${JSON.stringify(modelKey)}. Expected "provider/modelId".`,
		);
	}
	const providerId = modelKey.slice(0, slash);
	const modelId = modelKey.slice(slash + 1);
	const provider = config.providers[providerId];
	if (!provider) {
		throw new Error(
			`Refused operation "${operation}": model provider ${JSON.stringify(providerId)} not found. Call models.query list.`,
		);
	}
	const models = provider.models ?? [];
	if (models.length > 0 && !models.some((model) => model.id === modelId)) {
		throw new Error(
			`Refused operation "${operation}": model ${JSON.stringify(modelKey)} not found on provider ${JSON.stringify(providerId)}.`,
		);
	}
}

function cloneModelsConfig(config: ModelsConfig): ModelsConfig {
	return {
		...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
		providers: Object.fromEntries(
			Object.entries(config.providers).map(([id, provider]) => [
				id,
				{
					...provider,
					...(provider.headers === undefined ? {} : { headers: { ...provider.headers } }),
					...(provider.models === undefined ? {} : { models: provider.models.map((model) => ({ ...model })) }),
					...(provider.modelOverrides === undefined
						? {}
						: {
								modelOverrides: Object.fromEntries(
									Object.entries(provider.modelOverrides).map(([modelId, value]) => [modelId, { ...value }]),
								),
							}),
				},
			]),
		),
	};
}

function normalizeExternalApiKeySource(value: string): string | undefined {
	const trimmed = value.trim();
	if (/^![\s\S]+/.test(trimmed)) return trimmed;
	const envMatch = /^env:([A-Z_][A-Z0-9_]*)$/i.exec(trimmed);
	if (envMatch?.[1]) return envMatch[1];
	const commandMatch = /^cmd:([\s\S]+)$/i.exec(trimmed);
	if (commandMatch?.[1]) return `!${commandMatch[1]}`;
	if (/^[A-Z_][A-Z0-9_]*$/.test(trimmed)) return trimmed;
	return undefined;
}

function rendererConfig(config: ModelsConfig): ModelsConfig {
	const next = cloneModelsConfig(config);
	for (const provider of Object.values(next.providers)) {
		if (provider.credentialRef || (provider.apiKey && !normalizeExternalApiKeySource(provider.apiKey))) {
			provider.apiKey = MASKED_MODEL_API_KEY;
		}
	}
	return next;
}

type PersistInputMode = "renderer" | "resolved";

export class ModelSettingsService {
	private mutationQueue: Promise<void> = Promise.resolve();
	private legacyMigration: Promise<void> | undefined;

	constructor(private readonly options: ModelSettingsServiceOptions) {}

	async getConfig(): Promise<ModelsConfig> {
		await this.mutationQueue;
		await this.ensureLegacyCredentialsMigrated();
		return this.resolveCredentials(await this.options.readConfig());
	}

	async getRendererConfig(): Promise<ModelsConfig> {
		await this.mutationQueue;
		await this.ensureLegacyCredentialsMigrated();
		return rendererConfig(await this.options.readConfig());
	}

	/** Main-process only. IPC callers must not return this value to the renderer. */
	async getProviderApiKey(providerId: string): Promise<string | undefined> {
		return (await this.getConfig()).providers[providerId]?.apiKey;
	}

	async replaceConfig(config: ModelsConfig): Promise<void> {
		await this.runMutation(async () => {
			await this.ensureLegacyCredentialsMigrated();
			await this.persist(config, await this.options.readConfig(), "renderer");
		});
	}

	async list(): Promise<ModelListResult> {
		const config = await this.getConfig();
		return {
			defaultModel: config.defaultModel ?? null,
			providers: Object.entries(config.providers).map(([id, provider]) => ({
				id,
				displayName: provider.displayName ?? id,
				...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
				...(provider.api === undefined ? {} : { api: provider.api }),
				hasApiKey: Boolean(provider.apiKey),
				modelCount: provider.models?.length ?? 0,
				models: (provider.models ?? []).map((model) => ({
					id: model.id,
					...(model.name === undefined ? {} : { name: model.name }),
					...(model.api === undefined ? {} : { api: model.api }),
					...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
				})),
			})),
		};
	}

	async getSanitizedConfig(): Promise<ModelConfigSnapshot> {
		const config = await this.getConfig();
		const providers: Record<string, ModelProviderConfigSnapshot> = {};
		for (const [id, provider] of Object.entries(config.providers)) providers[id] = redactProvider(provider);
		return {
			...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
			providers,
		};
	}

	async getSanitizedProvider(providerId: string): Promise<ModelProviderDetail> {
		const config = await this.getConfig();
		const provider = config.providers[providerId];
		if (!provider) throw new Error(`Provider not found: ${providerId}`);
		return { provider: providerId, ...redactProvider(provider) };
	}

	async validateModelKey(modelKey: string, operation = "set-default"): Promise<void> {
		assertModelKeyExists(await this.getConfig(), modelKey, operation);
	}

	async setDefault(modelKey: string): Promise<ModelDefaultResult> {
		return this.runMutation(async () => {
			await this.ensureLegacyCredentialsMigrated();
			const config = await this.options.readConfig();
			assertModelKeyExists(config, modelKey, "set-default");
			await this.persist({ ...config, defaultModel: modelKey }, config, "resolved");
			return { defaultModel: modelKey };
		});
	}

	async upsertProvider(providerId: string, data: ModelProviderUpsertData): Promise<ModelProviderConfigSnapshot> {
		return this.runMutation(async () => {
			await this.ensureLegacyCredentialsMigrated();
			const config = await this.options.readConfig();
			const existing = config.providers[providerId] ?? {};
			const next: ProviderConfig = { ...existing };
			if (data.baseUrl !== undefined) next.baseUrl = data.baseUrl;
			if (data.apiKey !== undefined) next.apiKey = data.apiKey;
			if (data.api !== undefined) next.api = data.api;
			if (data.displayName !== undefined) next.displayName = data.displayName;
			if (data.authHeader !== undefined) next.authHeader = data.authHeader;
			if (data.headers !== undefined) next.headers = { ...data.headers };
			if (data.models !== undefined) next.models = data.models.map((model) => ({ ...model }));
			const persisted = await this.persist(
				{ ...config, providers: { ...config.providers, [providerId]: next } },
				config,
				"resolved",
			);
			return redactProvider(this.resolveProvider(persisted.providers[providerId] ?? {}));
		});
	}

	async removeProvider(providerId: string): Promise<void> {
		await this.runMutation(async () => {
			await this.ensureLegacyCredentialsMigrated();
			const config = await this.options.readConfig();
			if (!config.providers[providerId]) throw new Error(`Provider not found: ${providerId}`);
			const providers = { ...config.providers };
			delete providers[providerId];
			const next = { ...config, providers };
			if (next.defaultModel?.startsWith(`${providerId}/`)) delete next.defaultModel;
			await this.persist(next, config, "resolved");
		});
	}

	private async persist(config: ModelsConfig, current: ModelsConfig, mode: PersistInputMode): Promise<ModelsConfig> {
		const persisted = cloneModelsConfig(config);
		const writes = new Map<string, string>();
		const nextRefs = new Map<string, string>();

		for (const [providerId, provider] of Object.entries(persisted.providers)) {
			const currentProvider = current.providers[providerId];
			const value = provider.apiKey;
			const currentRef = provider.credentialRef ?? currentProvider?.credentialRef;

			if (mode === "renderer" && value === MASKED_MODEL_API_KEY) {
				if (currentRef) {
					provider.credentialRef = currentRef;
					delete provider.apiKey;
					this.registerCredentialRef(nextRefs, currentRef, providerId);
				} else if (currentProvider?.apiKey) {
					provider.apiKey = currentProvider.apiKey;
				} else {
					delete provider.apiKey;
				}
				continue;
			}

			if (value === undefined) {
				if (mode === "resolved" && currentRef) {
					provider.credentialRef = currentRef;
					this.registerCredentialRef(nextRefs, currentRef, providerId);
				} else {
					delete provider.credentialRef;
				}
				continue;
			}

			const externalSource = normalizeExternalApiKeySource(value);
			if (externalSource) {
				provider.apiKey = externalSource;
				delete provider.credentialRef;
				continue;
			}

			if (!this.options.credentials.isAvailable() && !currentRef && currentProvider?.apiKey === value) {
				provider.apiKey = value;
				continue;
			}

			const credentialRef = currentRef ?? randomUUID();
			provider.credentialRef = credentialRef;
			delete provider.apiKey;
			writes.set(credentialRef, value);
			this.registerCredentialRef(nextRefs, credentialRef, providerId);
		}

		const currentRefs = new Set(
			Object.values(current.providers)
				.map((provider) => provider.credentialRef)
				.filter((value): value is string => Boolean(value)),
		);
		const removals = [...currentRefs].filter((credentialRef) => !nextRefs.has(credentialRef));
		const affectedRefs = new Set([...writes.keys(), ...removals]);
		const snapshots = new Map<string, string | undefined>();
		for (const credentialRef of affectedRefs) {
			snapshots.set(credentialRef, this.options.credentials.get(credentialRef));
		}

		try {
			for (const [credentialRef, value] of writes) this.options.credentials.set(credentialRef, value);
			for (const credentialRef of removals) this.options.credentials.remove(credentialRef);
			await this.options.writeConfig(persisted);
		} catch (error) {
			this.restoreCredentials(snapshots);
			throw error;
		}
		await this.options.refreshRegistry();
		return persisted;
	}

	private resolveCredentials(config: ModelsConfig): ModelsConfig {
		const resolved = cloneModelsConfig(config);
		for (const provider of Object.values(resolved.providers)) {
			if (!provider.credentialRef) continue;
			const apiKey = this.options.credentials.get(provider.credentialRef);
			if (apiKey !== undefined) provider.apiKey = apiKey;
		}
		return resolved;
	}

	private resolveProvider(provider: ProviderConfig): ProviderConfig {
		if (!provider.credentialRef) return { ...provider };
		const apiKey = this.options.credentials.get(provider.credentialRef);
		return { ...provider, ...(apiKey === undefined ? {} : { apiKey }) };
	}

	private ensureLegacyCredentialsMigrated(): Promise<void> {
		if (!this.options.credentials.isAvailable()) return Promise.resolve();
		this.legacyMigration ??= this.migrateLegacyCredentials().catch((error) => {
			this.legacyMigration = undefined;
			throw error;
		});
		return this.legacyMigration;
	}

	private async migrateLegacyCredentials(): Promise<void> {
		const config = await this.options.readConfig();
		const migrated = cloneModelsConfig(config);
		const snapshots = new Map<string, string | undefined>();
		let changed = false;
		try {
			for (const provider of Object.values(migrated.providers)) {
				if (!provider.apiKey) continue;
				const externalSource = normalizeExternalApiKeySource(provider.apiKey);
				if (externalSource) {
					if (provider.apiKey !== externalSource || provider.credentialRef !== undefined) changed = true;
					provider.apiKey = externalSource;
					delete provider.credentialRef;
					continue;
				}
				const credentialRef = provider.credentialRef ?? randomUUID();
				snapshots.set(credentialRef, this.options.credentials.get(credentialRef));
				this.options.credentials.set(credentialRef, provider.apiKey);
				provider.credentialRef = credentialRef;
				delete provider.apiKey;
				changed = true;
			}
			if (!changed) return;
			await this.options.writeConfig(migrated);
		} catch (error) {
			this.restoreCredentials(snapshots);
			throw error;
		}
		await this.options.refreshRegistry();
	}

	private registerCredentialRef(refs: Map<string, string>, credentialRef: string, providerId: string): void {
		const duplicateOwner = refs.get(credentialRef);
		if (duplicateOwner && duplicateOwner !== providerId) {
			throw new Error("A model credential cannot be shared by multiple providers");
		}
		refs.set(credentialRef, providerId);
	}

	private restoreCredentials(snapshots: ReadonlyMap<string, string | undefined>): void {
		for (const [credentialRef, value] of snapshots) {
			try {
				if (value === undefined) this.options.credentials.remove(credentialRef);
				else this.options.credentials.set(credentialRef, value);
			} catch {
				// Preserve the original persistence error. A later migration can reconcile orphaned encrypted records.
			}
		}
	}

	private runMutation<Result>(mutation: () => Promise<Result>): Promise<Result> {
		const result = this.mutationQueue.then(mutation, mutation);
		this.mutationQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
