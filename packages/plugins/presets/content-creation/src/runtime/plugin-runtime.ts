import type { PluginContext } from "@vetta-org/plugin-sdk";
import { PluginContentArtifactStore } from "../generation/artifact-store";
import { ContentGenerationService } from "../generation/generation-service";
import { OpenAiImageProvider } from "../generation/openai-image-provider";
import { ContentProviderRegistry } from "../generation/provider-registry";
import { PluginContentProjectRepository } from "./project-repository";
import { ContentCreationWorkspace } from "./workspace";

let workspace: ContentCreationWorkspace | null = null;
let generationService: ContentGenerationService | null = null;
let notify: PluginContext["ui"]["notify"] | null = null;

export function initializePluginRuntime(ctx: PluginContext): ContentCreationWorkspace {
	workspace = new ContentCreationWorkspace(new PluginContentProjectRepository(ctx.fs, ctx.storage));
	const providers = new ContentProviderRegistry();
	providers.register(
		new OpenAiImageProvider(ctx.network, ctx.settings, {
			id: "openai",
			baseUrl: "https://api.openai.com/v1",
			apiKeySetting: "openaiApiKey",
			modelSetting: "openaiModel",
			defaultModel: "gpt-image-2",
		}),
	);
	providers.register(
		new OpenAiImageProvider(ctx.network, ctx.settings, {
			id: "custom",
			baseUrlSetting: "customBaseUrl",
			apiKeySetting: "customApiKey",
			modelSetting: "customModel",
		}),
	);
	generationService = new ContentGenerationService(workspace, providers, new PluginContentArtifactStore(ctx.storage));
	notify = ctx.ui.notify;
	return workspace;
}

export function getContentGenerationService(): ContentGenerationService {
	if (!generationService) throw new Error("content-creation generation runtime is not initialized");
	return generationService;
}

export function getContentCreationWorkspace(): ContentCreationWorkspace {
	if (!workspace) throw new Error("content-creation runtime is not initialized");
	return workspace;
}

export function notifyContentCreationError(message: string, error: unknown): void {
	notify?.({ message, error });
}
