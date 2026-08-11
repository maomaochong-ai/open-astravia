import { join } from "node:path";
import {
	type Api,
	getModels,
	getProviders,
	type KnownProvider,
	type Model,
	registerApiProvider,
	registerOAuthProvider,
	type SimpleStreamOptions,
} from "@vetta/ai";
import { getAgentDir } from "../config.js";
import { resolveConfigHeaders, resolveConfigValue } from "../configuration/config-value-resolver.js";
import { loadLocalModelConfig, type ModelConfigFileSource } from "./configuration/local-model-config.js";
import { applyProviderAndModelOverrides, mergeCompat, mergeModels } from "./configuration/model-merge.js";
import type { CodingAgentModelRuntime, CodingAgentProviderConfig, ModelCredentialStore } from "./model-contracts.js";
import { loadRemoteModelSource, type RemoteModelSourceOptions } from "./remote/remote-model-source.js";

const NO_AUTH_PLACEHOLDER = "no-auth-needed-for-local-provider";

export interface CreateCodingAgentModelRuntimeOptions {
	readonly modelsJsonPath?: string;
	readonly configFileSource?: ModelConfigFileSource;
	readonly remoteSource?: RemoteModelSourceOptions;
	/** 仅用于确定性测试或嵌入式宿主；生产默认读取 @vetta/ai 目录。 */
	readonly builtInModels?: readonly Model<Api>[];
}

export function createCodingAgentModelRuntime(
	credentials: ModelCredentialStore,
	options: CreateCodingAgentModelRuntimeOptions = {},
): CodingAgentModelRuntime {
	return new ModelRuntimeImplementation(
		credentials,
		options.modelsJsonPath ?? join(getAgentDir(), "models.json"),
		options.configFileSource,
		options.remoteSource,
		options.builtInModels,
	);
}

class ModelRuntimeImplementation implements CodingAgentModelRuntime {
	private models: Model<Api>[] = [];
	private customProviderApiKeys = new Map<string, string>();
	private customProviderNames = new Set<string>();
	private registeredProviders = new Map<string, CodingAgentProviderConfig>();
	private loadError: string | undefined;
	private remoteModels: readonly Model<Api>[] = [];
	private remoteModelKeys: ReadonlySet<string> = new Set();
	private serverUrl: string | undefined;
	private serverToken: string | undefined;
	private serverTokenGetter: (() => string | undefined) | undefined;
	private remoteLoadAttempted = false;
	private remoteLoadInflight: Promise<"unauthorized" | undefined> | undefined;

	constructor(
		private readonly credentials: ModelCredentialStore,
		private readonly modelsJsonPath: string | undefined,
		private readonly configFileSource: ModelConfigFileSource | undefined,
		private readonly remoteSource: RemoteModelSourceOptions | undefined,
		private readonly builtInModels: readonly Model<Api>[] | undefined,
	) {
		credentials.setFallbackResolver((provider) => {
			const configured = this.customProviderApiKeys.get(provider);
			return configured ? resolveConfigValue(configured) : undefined;
		});
		this.rebuildModels();
	}

	setServerUrl(url: string | undefined): void {
		this.serverUrl = url;
	}

	setServerToken(token: string | undefined): void {
		if (this.serverToken !== token) this.remoteLoadAttempted = false;
		this.serverToken = token;
	}

	setServerTokenGetter(getter: () => string | undefined): void {
		this.serverTokenGetter = getter;
	}

	loadRemoteModels(): Promise<"unauthorized" | undefined> {
		const token = this.readServerToken();
		if (!this.serverUrl || !token) return Promise.resolve(undefined);
		if (this.remoteLoadInflight) return this.remoteLoadInflight;
		this.remoteLoadInflight = this.loadRemote(this.serverUrl, token).finally(() => {
			this.remoteLoadInflight = undefined;
			this.remoteLoadAttempted = true;
		});
		return this.remoteLoadInflight;
	}

	refresh(): void {
		this.rebuildModels();
	}

	getError(): string | undefined {
		return this.loadError;
	}

	getAll(): Model<Api>[] {
		return this.models;
	}

	getAvailable(): Model<Api>[] {
		return this.models.filter(
			(model) =>
				this.isRemote(model) ||
				this.customProviderNames.has(model.provider) ||
				this.credentials.hasAuth(model.provider),
		);
	}

	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find((model) => model.provider === provider && model.id === modelId);
	}

	isRemote(model: Model<Api>): boolean {
		return this.remoteModelKeys.has(`${model.provider}/${model.id}`);
	}

	getRemoteProviders(): Set<string> {
		return new Set([...this.remoteModelKeys].map((key) => key.split("/")[0] as string));
	}

	async getApiKey(model: Model<Api>): Promise<string | undefined> {
		const token = this.readServerToken();
		await this.ensureRemoteLoaded(token);
		if (this.isRemote(model) && token) return token;
		const key = await this.credentials.getApiKey(model.provider);
		if (key) return key;
		if (this.customProviderNames.has(model.provider) && !this.isUsingOAuth(model)) return NO_AUTH_PLACEHOLDER;
		return undefined;
	}

	async getApiKeyForProvider(provider: string): Promise<string | undefined> {
		const token = this.readServerToken();
		await this.ensureRemoteLoaded(token);
		if (this.getRemoteProviders().has(provider) && token) return token;
		const key = await this.credentials.getApiKey(provider);
		if (key) return key;
		if (this.customProviderNames.has(provider) && this.credentials.get(provider)?.type !== "oauth") {
			return NO_AUTH_PLACEHOLDER;
		}
		return undefined;
	}

	isUsingOAuth(model: Model<Api>): boolean {
		return this.credentials.get(model.provider)?.type === "oauth";
	}

	registerProvider(providerName: string, config: CodingAgentProviderConfig): void {
		this.registeredProviders.set(providerName, config);
		this.applyProviderConfig(providerName, config);
	}

	private async loadRemote(serverUrl: string, token: string): Promise<"unauthorized" | undefined> {
		const result = await loadRemoteModelSource(serverUrl, token, this.remoteSource);
		if (result.status === "unauthorized") return "unauthorized";
		if (result.status === "loaded") {
			this.remoteModels = result.models;
			this.remoteModelKeys = result.modelKeys;
			this.rebuildModels();
		}
		return undefined;
	}

	private rebuildModels(): void {
		const local = loadLocalModelConfig(this.modelsJsonPath, this.configFileSource);
		this.customProviderApiKeys = new Map(local.apiKeys);
		this.customProviderNames = new Set(local.providerNames);
		this.loadError = local.error;

		const builtInModels = this.builtInModels
			? this.builtInModels.flatMap((model) =>
					applyProviderAndModelOverrides(
						[{ ...model }],
						local.overrides.get(model.provider),
						local.modelOverrides.get(model.provider),
					),
				)
			: getProviders().flatMap((provider) =>
					applyProviderAndModelOverrides(
						getModels(provider as KnownProvider) as Model<Api>[],
						local.overrides.get(provider),
						local.modelOverrides.get(provider),
					),
				);
		let combined = mergeModels(builtInModels, local.models);
		combined = mergeModels(combined, this.remoteModels);
		for (const oauthProvider of this.credentials.getOAuthProviders()) {
			const credential = this.credentials.get(oauthProvider.id);
			if (credential?.type === "oauth" && oauthProvider.modifyModels) {
				combined = oauthProvider.modifyModels(combined, credential);
			}
		}
		this.models = combined;
		for (const [name, config] of this.registeredProviders) this.applyProviderConfig(name, config);
	}

	private applyProviderConfig(providerName: string, config: CodingAgentProviderConfig): void {
		if (config.oauth) registerOAuthProvider({ ...config.oauth, id: providerName });
		if (config.streamSimple) {
			if (!config.api) throw new Error(`Provider ${providerName}: "api" is required when registering streamSimple.`);
			const streamSimple = config.streamSimple;
			registerApiProvider({
				api: config.api,
				stream: (model, context, options) => streamSimple(model, context, options as SimpleStreamOptions),
				streamSimple,
			});
		}
		if (config.apiKey) this.customProviderApiKeys.set(providerName, config.apiKey);
		if (config.models && config.models.length > 0) {
			if (!config.baseUrl) throw new Error(`Provider ${providerName}: "baseUrl" is required when defining models.`);
			if (!config.apiKey && !config.oauth) {
				throw new Error(`Provider ${providerName}: "apiKey" or "oauth" is required when defining models.`);
			}
			this.models = this.models.filter((model) => model.provider !== providerName);
			this.customProviderNames.add(providerName);
			for (const definition of config.models) {
				const api = definition.api || config.api;
				if (!api) throw new Error(`Provider ${providerName}, model ${definition.id}: no "api" specified.`);
				const providerHeaders = resolveConfigHeaders(config.headers);
				const modelHeaders = resolveConfigHeaders(definition.headers);
				let headers = providerHeaders || modelHeaders ? { ...providerHeaders, ...modelHeaders } : undefined;
				if (config.authHeader && config.apiKey) {
					const key = resolveConfigValue(config.apiKey);
					if (key) headers = { ...headers, Authorization: `Bearer ${key}` };
				}
				this.models.push({
					...definition,
					input: [...definition.input],
					api,
					provider: providerName,
					baseUrl: config.baseUrl,
					headers,
					compat: mergeCompat(config.compat, definition.compat),
				});
			}
			if (config.oauth?.modifyModels) {
				const credential = this.credentials.get(providerName);
				if (credential?.type === "oauth") this.models = config.oauth.modifyModels(this.models, credential);
			}
		} else if (config.baseUrl) {
			const headers = resolveConfigHeaders(config.headers);
			this.models = this.models.map((model) =>
				model.provider === providerName
					? {
							...model,
							baseUrl: config.baseUrl ?? model.baseUrl,
							headers: headers ? { ...model.headers, ...headers } : model.headers,
						}
					: model,
			);
		}
	}

	private readServerToken(): string | undefined {
		return this.serverTokenGetter ? this.serverTokenGetter() : this.serverToken;
	}

	private async ensureRemoteLoaded(token: string | undefined): Promise<void> {
		if (!token || this.remoteModelKeys.size > 0 || this.remoteLoadAttempted) return;
		await this.loadRemoteModels();
	}
}
