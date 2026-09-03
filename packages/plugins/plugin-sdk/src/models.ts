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

/** Manages only provider ids derived from the calling plugin and a plugin-local id. */
export interface PluginModelsApi {
	upsertProvider(providerId: string, data: PluginModelProviderConfig): Promise<void>;
	/** Removes the plugin-owned provider when present. Repeated removal is an idempotent no-op. */
	removeProvider(providerId: string): Promise<void>;
}
