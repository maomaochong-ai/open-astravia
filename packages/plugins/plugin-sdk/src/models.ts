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
	/**
	 * Reads back what the host currently holds for this plugin, keyed by the same
	 * local provider ids `replaceOwnedProviders` accepts.
	 *
	 * `replaceOwnedProviders` deletes by omission, so a plugin that cannot read its
	 * own published state can only clobber it — every write has to reconstruct the
	 * whole truth from whatever its (often eventually consistent) upstream happens
	 * to report at that instant. Read this first and reconcile against it, so a
	 * model that is merely not visible yet is not mistaken for one the user lost.
	 *
	 * `apiKey` comes back masked; supply the real credential on the next write.
	 */
	listOwnedProviders(): Promise<Record<string, PluginModelProviderConfig>>;
}
