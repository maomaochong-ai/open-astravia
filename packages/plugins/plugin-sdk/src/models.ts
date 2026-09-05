export interface PluginModelDefinition {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

export interface PluginModelProviderConfig {
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	displayName?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	models?: PluginModelDefinition[];
}

/** Reconciles the complete set of provider ids owned by the calling plugin. */
export interface PluginModelsApi {
	replaceOwnedProviders(providers: Record<string, PluginModelProviderConfig>): Promise<void>;
}
