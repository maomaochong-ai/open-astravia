import type {
	PluginContext,
	PluginPromptAttachment,
	PluginRegisterShortcutScope,
} from "@vetta-org/plugin-sdk";
import { readJsonFile, writeJsonFile } from "@vetta-org/plugin-sdk";
import { ContentCreationAgentService } from "../agent/service";
import { ContentAssetPreviewResolver } from "../generation/asset-preview-resolver";
import { ContentAssetImportService } from "../generation/asset-import-service";
import { PluginContentArtifactStore } from "../generation/artifact-store";
import { createContentProviderRegistry } from "../generation/create-provider-registry";
import { ContentGenerationService } from "../generation/generation-service";
import { ContentLocalAssetService } from "../generation/local-asset-service";
import { PluginContentProjectHistoryRepository } from "../project/history-repository";
import { PluginContentProjectRepository } from "../project/repository";
import { ContentCreationWorkspace } from "../project/workspace";
import { ContentPromptOptimizationService } from "../prompt-optimization/prompt-optimization-service";
import { ContentSettingsStore } from "../settings/content-settings";
import { SETTINGS_VIEW_ID } from "../settings/view-id";
import { ContentRunApprovalStore } from "./run-approval";

/** Resources owned by one plugin activation. Instances may overlap during hot reload. */
export class ContentCreationPluginRuntime {
	readonly workspace: ContentCreationWorkspace;
	readonly agent: ContentCreationAgentService;
	readonly assetPreviewResolver: ContentAssetPreviewResolver;
	readonly localAssets: ContentLocalAssetService;
	readonly promptOptimization: ContentPromptOptimizationService;
	readonly runApprovals = new ContentRunApprovalStore();
	readonly settings: ContentSettingsStore;

	private generationRuntime: ContentGenerationService | null = null;
	private mediaProviderSubscription: { dispose(): void } | null = null;
	private settingsSubscription: { dispose(): void } | null = null;
	private mediaProviderRefreshVersion = 0;
	private historyPersistenceErrorNotified = false;
	private readonly modelListeners = new Set<() => void>();
	private disposed = false;
	private readonly artifacts: PluginContentArtifactStore;
	private readonly assetImports: ContentAssetImportService;

	private constructor(private readonly ctx: PluginContext) {
		this.settings = new ContentSettingsStore({
			readJson: (key) => readJsonFile<unknown>(ctx.storage, key),
			writeJson: (key, value) => writeJsonFile(ctx.storage, key, value).then(() => undefined),
			readSecret: (key) => ctx.secrets.get(key),
			writeSecret: (key, value) => ctx.secrets.set(key, value),
		});
		this.workspace = new ContentCreationWorkspace(new PluginContentProjectRepository(ctx.fs, ctx.storage), {
			historyRepository: new PluginContentProjectHistoryRepository(ctx.storage),
			onHistoryPersistenceError: (error) => {
				if (this.historyPersistenceErrorNotified) return;
				this.historyPersistenceErrorNotified = true;
				ctx.ui.notify({ message: ctx.i18n.t("error.historyPersistence"), error });
			},
		});
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

	/** 面板里的「设置」入口：跳到本插件自己的工作区配置页（ADR-0105）。 */
	openSettings = (): void => {
		this.ctx.ui.openWorkspaceView(SETTINGS_VIEW_ID);
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
		// 密钥改动会改变可用模型清单，所以配置页保存后要重新广播一次。
		this.settingsSubscription = { dispose: this.settings.subscribe(() => this.emitModelsChanged()) };
		await this.settings.load();
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
			this.settings,
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
