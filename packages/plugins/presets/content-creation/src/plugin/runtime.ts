import type { PluginContext } from "@vetta-org/plugin-sdk";
import { ContentAssetPreviewResolver } from "../generation/asset-preview-resolver";
import { PluginContentArtifactStore } from "../generation/artifact-store";
import { createContentProviderRegistry } from "../generation/create-provider-registry";
import { ContentGenerationService } from "../generation/generation-service";
import { PluginContentProjectRepository } from "../project/repository";
import { ContentCreationWorkspace } from "../project/workspace";

let workspace: ContentCreationWorkspace | null = null;
let generationService: ContentGenerationService | null = null;
let assetPreviewResolver: ContentAssetPreviewResolver | null = null;
let notify: PluginContext["ui"]["notify"] | null = null;

export function initializePluginRuntime(ctx: PluginContext): ContentCreationWorkspace {
	workspace = new ContentCreationWorkspace(new PluginContentProjectRepository(ctx.fs, ctx.storage));
	assetPreviewResolver = new ContentAssetPreviewResolver(ctx.storage);
	const providers = createContentProviderRegistry(ctx.network, ctx.settings);
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

export function getContentAssetPreviewResolver(): ContentAssetPreviewResolver {
	if (!assetPreviewResolver) throw new Error("content-creation asset runtime is not initialized");
	return assetPreviewResolver;
}

export function notifyContentCreationError(message: string, error: unknown): void {
	notify?.({ message, error });
}
