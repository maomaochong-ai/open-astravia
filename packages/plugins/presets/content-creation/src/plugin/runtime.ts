import type {
	PluginContext,
	PluginPromptAttachment,
	PluginRegisterShortcutScope,
} from "@vetta-org/plugin-sdk";
import { ContentCreationAgentService } from "../agent/service";
import { ContentAssetPreviewResolver } from "../generation/asset-preview-resolver";
import { ContentAssetImportService } from "../generation/asset-import-service";
import { PluginContentArtifactStore } from "../generation/artifact-store";
import { createContentProviderRegistry } from "../generation/create-provider-registry";
import { ContentGenerationService } from "../generation/generation-service";
import { ContentLocalAssetService } from "../generation/local-asset-service";
import { PluginContentProjectRepository } from "../project/repository";
import { ContentCreationWorkspace } from "../project/workspace";
import { ContentPromptOptimizationService } from "../prompt-optimization/prompt-optimization-service";
import { ContentRunApprovalStore } from "./run-approval";

/** Resources owned by one plugin activation. Instances may overlap during hot reload. */
export class ContentCreationPluginRuntime {
	readonly workspace: ContentCreationWorkspace;
	readonly agent: ContentCreationAgentService;
	readonly assetPreviewResolver: ContentAssetPreviewResolver;
	readonly localAssets: ContentLocalAssetService;
	readonly promptOptimization: ContentPromptOptimizationService;
	readonly runApprovals = new ContentRunApprovalStore();

	private generationRuntime: ContentGenerationService | null = null;
	private mediaProviderSubscription: { dispose(): void } | null = null;
	private settingsSubscription: { dispose(): void } | null = null;
	private mediaProviderRefreshVersion = 0;
	private readonly modelListeners = new Set<() => void>();
	private disposed = false;
	private readonly artifacts: PluginContentArtifactStore;
	private readonly assetImports: ContentAssetImportService;

	private constructor(private readonly ctx: PluginContext) {
		this.workspace = new ContentCreationWorkspace(new PluginContentProjectRepository(ctx.fs, ctx.storage));
		const artifacts = new PluginContentArtifactStore(ctx.fs, ctx.storage, ctx.artifacts);
		const assetImports = new ContentAssetImportService(this.workspace, artifacts);
		this.agent = new ContentCreationAgentService(this.workspace, () => this.generation);
		this.assetPreviewResolver = new ContentAssetPreviewResolver(ctx.fs, ctx.storage);
		this.localAssets = new ContentLocalAssetService(ctx.fs, assetImports);
		this.promptOptimization = new ContentPromptOptimizationService(ctx.ai);
		this.artifacts = artifacts;
		this.assetImports = assetImports;
	}

	static async create(ctx: PluginContext): Promise<ContentCreationPluginRuntime> {
		const runtime = new ContentCreationPluginRuntime(ctx);
		try {
			await runtime.initialize();
			return runtime;
		} catch (error) {
			runtime.dispose();
			throw error;
		}
	}

	get generation(): ContentGenerationService {
		if (!this.generationRuntime) {
			throw new Error("content-creation generation runtime is not available");
		}
		return this.generationRuntime;
	}

	registerShortcutScope: PluginRegisterShortcutScope = (contribution) =>
		this.ctx.ui.registerShortcutScope(contribution);

	maximizeActivityPanel(): void {
		this.ctx.ui.setActivityPanelWidth("max");
	}

	openPluginSettings = (): void => {
		this.ctx.ui.openPluginSettings();
	};

	publishPromptAttachment(attachment: PluginPromptAttachment | null): void {
		this.ctx.ui.setPromptAttachment(attachment);
	}

	notifyError(message: string, error: unknown): void {
		this.ctx.ui.notify({ message, error });
	}

	subscribeModels(listener: () => void): () => void {
		if (this.disposed) return () => undefined;
		this.modelListeners.add(listener);
		return () => this.modelListeners.delete(listener);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.runApprovals.clear();
		this.mediaProviderRefreshVersion += 1;
		this.generationRuntime?.dispose();
		this.mediaProviderSubscription?.dispose();
		this.settingsSubscription?.dispose();
		this.mediaProviderSubscription = null;
		this.settingsSubscription = null;
		this.modelListeners.clear();
	}

	private async initialize(): Promise<void> {
		this.mediaProviderSubscription = this.ctx.media.onProvidersChanged(() => {
			void this.refreshMediaProviders();
		});
		this.settingsSubscription = this.ctx.settings.onChange(() => this.emitModelsChanged());
		await this.refreshMediaProviders();
	}

	private async refreshMediaProviders(): Promise<void> {
		const refreshVersion = ++this.mediaProviderRefreshVersion;
		const mediaProviders = await this.ctx.media.listProviders().catch((error: unknown) => {
			this.ctx.ui.notify({ message: this.ctx.i18n.t("error.mediaProviderDiscovery"), error });
			return [];
		});
		if (this.disposed || refreshVersion !== this.mediaProviderRefreshVersion) return;

		const providers = createContentProviderRegistry(
			this.ctx.network,
			this.ctx.settings,
			this.ctx.media,
			this.ctx.jobs,
			mediaProviders,
		);
		const nextGenerationRuntime = new ContentGenerationService(
			this.workspace,
			providers,
			this.artifacts,
			this.assetImports,
		);
		const previousGenerationRuntime = this.generationRuntime;
		this.generationRuntime = nextGenerationRuntime;
		previousGenerationRuntime?.dispose();
		this.emitModelsChanged();
	}

	private emitModelsChanged(): void {
		if (this.disposed) return;
		for (const listener of this.modelListeners) listener();
	}
}
