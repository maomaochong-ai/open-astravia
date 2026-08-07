import type { PluginContext } from "@vetta-org/plugin-sdk";
import { ContentAssetPreviewResolver } from "../generation/asset-preview-resolver";
import { PluginContentArtifactStore } from "../generation/artifact-store";
import { createContentProviderRegistry } from "../generation/create-provider-registry";
import { ContentGenerationService } from "../generation/generation-service";
import { PluginContentProjectRepository } from "../project/repository";
import { ContentCreationWorkspace } from "../project/workspace";
import { ContentPromptOptimizationService } from "../prompt-optimization/prompt-optimization-service";

let workspace: ContentCreationWorkspace | null = null;
let generationService: ContentGenerationService | null = null;
let assetPreviewResolver: ContentAssetPreviewResolver | null = null;
let promptOptimizationService: ContentPromptOptimizationService | null = null;
let notify: PluginContext["ui"]["notify"] | null = null;
let mediaProviderSubscription: { dispose(): void } | null = null;
let mediaProviderRefreshVersion = 0;

async function refreshMediaProviders(ctx: PluginContext): Promise<void> {
	const refreshVersion = ++mediaProviderRefreshVersion;
	const mediaProviders = await ctx.media.listProviders().catch((error: unknown) => {
		ctx.ui.notify({ message: ctx.i18n.t("error.mediaProviderDiscovery"), error });
		return [];
	});
	if (refreshVersion !== mediaProviderRefreshVersion || !workspace) return;
	const providers = createContentProviderRegistry(ctx.network, ctx.settings, ctx.media, ctx.jobs, mediaProviders);
	generationService = new ContentGenerationService(
		workspace,
		providers,
		new PluginContentArtifactStore(ctx.fs, ctx.storage, ctx.artifacts),
	);
}

export async function initializePluginRuntime(ctx: PluginContext): Promise<ContentCreationWorkspace> {
	mediaProviderSubscription?.dispose();
	workspace = new ContentCreationWorkspace(new PluginContentProjectRepository(ctx.fs, ctx.storage));
	assetPreviewResolver = new ContentAssetPreviewResolver(ctx.fs, ctx.storage);
	promptOptimizationService = new ContentPromptOptimizationService(ctx.ai);
	notify = ctx.ui.notify;
	mediaProviderSubscription = ctx.media.onProvidersChanged(() => {
		void refreshMediaProviders(ctx);
	});
	await refreshMediaProviders(ctx);
	return workspace;
}

export function disposePluginRuntime(): void {
	mediaProviderRefreshVersion += 1;
	mediaProviderSubscription?.dispose();
	mediaProviderSubscription = null;
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

export function getContentPromptOptimizationService(): ContentPromptOptimizationService {
	if (!promptOptimizationService) throw new Error("content-creation prompt optimization runtime is not initialized");
	return promptOptimizationService;
}

export function notifyContentCreationError(message: string, error: unknown): void {
	notify?.({ message, error });
}
