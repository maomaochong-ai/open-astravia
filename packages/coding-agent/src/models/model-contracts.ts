import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Model,
	OAuthCredentials,
	OAuthProviderInterface,
	SimpleStreamOptions,
} from "@vetta/ai";

declare module "@vetta/ai" {
	// biome-ignore lint/correctness/noUnusedVariables: 模块增强的类型参数名必须与原声明一致
	interface Model<TApi extends Api> {
		modelId?: string;
	}
}

export type ModelCredential =
	| { readonly type: "api_key"; readonly key: string }
	| ({ readonly type: "oauth" } & OAuthCredentials);

export interface ModelCredentialStore {
	setFallbackResolver(resolver: (provider: string) => string | undefined): void;
	get(provider: string): ModelCredential | undefined;
	hasAuth(provider: string): boolean;
	getApiKey(provider: string): Promise<string | undefined>;
	getOAuthProviders(): readonly OAuthProviderInterface[];
}

export interface CodingAgentProviderConfig {
	readonly baseUrl?: string;
	readonly apiKey?: string;
	readonly api?: Api;
	readonly streamSimple?: (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
	readonly headers?: Readonly<Record<string, string>>;
	readonly authHeader?: boolean;
	readonly compat?: Model<Api>["compat"];
	readonly oauth?: Omit<OAuthProviderInterface, "id">;
	readonly models?: readonly CodingAgentProviderModel[];
}

export interface CodingAgentProviderModel {
	readonly id: string;
	readonly name: string;
	readonly api?: Api;
	readonly reasoning: boolean;
	readonly input: readonly ("text" | "image")[];
	readonly cost: Model<Api>["cost"];
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly headers?: Readonly<Record<string, string>>;
	readonly compat?: Model<Api>["compat"];
}

export interface CodingAgentModelCatalogView {
	refresh(): void;
	getError(): string | undefined;
	getAll(): Model<Api>[];
	getAvailable(): Model<Api>[];
	find(provider: string, modelId: string): Model<Api> | undefined;
	isRemote(model: Model<Api>): boolean;
	getRemoteProviders(): Set<string>;
}

export interface CodingAgentModelRuntime extends CodingAgentModelCatalogView {
	getApiKey(model: Model<Api>): Promise<string | undefined>;
	getApiKeyForProvider(provider: string): Promise<string | undefined>;
	isUsingOAuth(model: Model<Api>): boolean;
	registerProvider(providerName: string, config: CodingAgentProviderConfig): void;
	setServerUrl(url: string | undefined): void;
	setServerToken(token: string | undefined): void;
	setServerTokenGetter(getter: () => string | undefined): void;
	loadRemoteModels(): Promise<"unauthorized" | undefined>;
}
