import type { PluginNetworkApi, PluginSettingsApi } from "@vetta-org/plugin-sdk";
import { GeminiProvider } from "./gemini-provider";
import { OPENAI_IMAGE_MODELS } from "./model-catalog";
import { NewApiVideoProvider } from "./newapi-video-provider";
import { OpenAiImageProvider } from "./openai-image-provider";
import { ContentProviderRegistry } from "./provider-registry";
import { ReplicateProvider } from "./replicate-provider";

export function createContentProviderRegistry(
	network: PluginNetworkApi,
	settings: PluginSettingsApi,
): ContentProviderRegistry {
	const registry = new ContentProviderRegistry();
	registry.register(
		new OpenAiImageProvider(network, settings, {
			id: "openai",
			baseUrl: "https://api.openai.com/v1",
			apiKeySetting: "openaiApiKey",
			modelSetting: "openaiModel",
			models: OPENAI_IMAGE_MODELS,
		}),
	);
	registry.register(
		new OpenAiImageProvider(network, settings, {
			id: "custom",
			baseUrlSetting: "customBaseUrl",
			apiKeySetting: "customApiKey",
			modelSetting: "customModel",
		}),
	);
	registry.register(new ReplicateProvider(network, settings, { apiTokenSetting: "replicateApiToken" }));
	registry.register(new GeminiProvider(network, settings, { apiKeySetting: "googleApiKey" }));
	registry.register(
		new NewApiVideoProvider(network, settings, {
			id: "custom-video",
			baseUrlSetting: "customBaseUrl",
			apiKeySetting: "customApiKey",
			modelSetting: "customVideoModel",
		}),
	);
	return registry;
}
