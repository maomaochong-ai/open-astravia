import type {
	AgentExperimentalSettings,
	AgentExperimentalSettingsUpdate,
	AiCompleteInput,
	AiCompleteResult,
	AiModelListResult,
	BatchProject,
	BatchProjectCreateData,
	BatchProjectUpdateData,
	BatchTaskCommandResult,
	DownloadItem as CapabilityDownloadItem,
	DefaultExecutionModeSettingInput,
	GeneralExecutionMode,
	GeneralSettingsSnapshot,
	ImLogEntry,
	ImRuntimeStatus,
	ImStatusSnapshot,
	InstalledSkill,
	Job,
	KnowledgeBase,
	KnowledgeFileStatuses,
	KnowledgeProcessingSettings,
	KnowledgeProcessingUpdate,
	KnowledgeScanResult,
	McpServerDetail,
	McpServerSummary,
	McpServerUpsertData,
	MediaProviderDescriptor,
	ModelConfigSnapshot,
	ModelDefaultResult,
	ModelListResult,
	ModelProbeResult,
	ModelProviderConfigSnapshot,
	ModelProviderDetail,
	ModelProviderUpsertData,
	NotificationsSettingInput,
	PersistedArtifact,
	ProjectEntry,
	ProjectListResult,
	QuickPanelPostSendBehavior,
	QuickPanelSettings,
	QuickPanelTrigger,
	SchedulerCommandResult,
	SchedulerExecutionRecord,
	SchedulerTask,
	SchedulerTaskCreateData,
	SchedulerTaskUpdateData,
	SessionHistoryEntry,
	SessionRuntimeProject,
	ShortcutBindingResetResult,
	ShortcutBindingsResult,
	ShortcutSettings,
	SkillInfo,
	SkillSetEnabledResult,
	SkillType,
	UpdaterState,
	WebhookCreateData,
	WebhookEndpoint,
	WebhookMessage,
	WebhookProviderDescriptor,
	WebhookSendResult,
	WebhookUpdateData,
	WorkspaceSettingInput,
} from "@vetta/capability-sdk";
import type {
	PluginAgentManifest,
	PluginArtifactDestination,
	PluginCodingAgentHookEvent,
	PluginCodingAgentHookEventName,
	PluginMediaCapability,
	PluginMediaInputUploadRequest,
	PluginMediaJob,
	PluginMediaProviderJob,
	PluginMediaProviderSubmitRequest,
	PluginMediaSubmitRequest,
	PluginMediaTransferResponse,
	PluginPermission,
	PluginPutBlobFromFileInput,
	PluginSettingSchema,
} from "@vetta-org/plugin-sdk";

export type {
	PluginAgentManifest,
	PluginManifest,
	PluginMcpServerConfig,
	PluginPermission,
	PluginSettingSchema,
} from "@vetta-org/plugin-sdk";

/** 一份扁平 catalog：翻译 key → 本地化字符串。 */
export type PluginLocaleCatalog = Record<string, string>;
/** 插件随包发的全部 catalog，按 locale code 归集（如 "zh"、"en"）。 */
export type PluginLocales = Record<string, PluginLocaleCatalog>;

/**
 * Dev 热更新（插件工作台）：内存态 dev 链接快照，不落注册表。
 * 存在即表示该插件资源正从开发工程目录（而非安装目录）加载。
 */
export interface PluginDevWatchState {
	/** 开发工程根目录（含 plugin.json 与 src/）。 */
	projectDir: string;
	/** Vite 开发服务器入口；starting 阶段尚不可用。 */
	entryUrl?: string;
	/** Vite 开发服务器 origin，供诊断与 React Fast Refresh 初始化。 */
	origin?: string;
	/** starting = 开发服务器正在启动；error 详见 error 字段。 */
	status: "starting" | "running" | "error";
	error?: string;
}

export interface PluginsChangedEvent {
	/** 缺省表示完整重载；存在时仅替换列出的插件生命周期。 */
	pluginIds?: string[];
	/** false 表示仅状态更新，渲染进程无需重载插件。 */
	reload?: boolean;
	reason?: "dev-ready" | "dev-update" | "dev-status";
}

export type PluginTrustLevel = "official" | "community" | "local";

export interface PluginNpmDistribution {
	packageName: string;
	requestedSpec: string;
	resolvedVersion: string;
	integrity?: string;
}

export interface InstalledPlugin {
	id: string;
	name: string;
	version: string;
	activeVersion: string;
	pluginApiVersion: string;
	runtime: "esm" | "module-federation" | "quickjs";
	entryUrl: string;
	moduleFederation?: {
		remoteName: string;
		expose: string;
	};
	agent?: PluginAgentManifest;
	styleUrls: string[];
	permissions: PluginPermission[];
	grantedPermissions: PluginPermission[];
	/** Normalized host/IP patterns declared in plugin.json `network.allowedHosts`. */
	allowedNetworkHosts: string[];
	/** Executable names declared in plugin.json `commands`. */
	declaredCommands: string[];
	/** Subset of declaredCommands the user currently allows (toggleable per command). */
	grantedCommandNames: string[];
	settingsSchema?: PluginSettingSchema[];
	description?: string;
	author?: string;
	/**
	 * 见 PluginManifest.icon —— 已解析为可直接渲染的值：Iconify 名 / 外链原样，
	 * 包内相对路径已转成带 cache key 的 `vetta-plugin://` URL。未声明图标时为 undefined。
	 */
	iconUrl?: string;
	/** 见 PluginManifest.guidingWords —— NewSessionPage 欢迎页消费。 */
	guidingWords?: string[];
	/** 缺译回退 locale（见 PluginManifest.defaultLocale）。 */
	defaultLocale: string;
	/**
	 * 宿主加载的全部语言 catalog（main 读 `locales/<lang>.json`，随本对象一次性下发）。
	 * 同时服务 manifest 占位符解析与运行期组件 `t()`（ADR-0033）。
	 */
	locales: PluginLocales;
	enabled: boolean;
	/** 宿主必需插件；不可停用或卸载，不由 manifest 自行声明。 */
	required: boolean;
	installedAt: string;
	updatedAt: string;
	source: "archive" | "remote" | "npm" | "system";
	/** npm distribution provenance for the currently packaged `version`. */
	distribution?: PluginNpmDistribution;
	/** 执行权限信任级别；与安装来源分离，不能由插件 manifest 自行声明。 */
	trustLevel: PluginTrustLevel;
	availableVersion?: string;
	pendingVersion?: string;
	/**
	 * Absolute filesystem root of the active plugin package
	 * (system staging dir, or `~/.vetta/plugins/<id>/versions/<activeVersion>`).
	 */
	rootPath: string;
	/** 存在即该插件处于 dev 热更新链接（资源改从工程目录加载）。 */
	devWatch?: PluginDevWatchState;
}

export interface PluginInstallOptions {
	source?: "archive" | "remote" | "npm";
	grantedPermissions?: PluginPermission[];
	/** When true, enable the plugin after install (default false for GUI parity; agent path may set true). */
	enable?: boolean;
	/** Expected sha256 of the archive, from the market entry. Omitted for entries uploaded before digests existed. */
	expectedSha256?: string;
	/** npm envelope identity. The host verifies both values against plugin.json before copying files. */
	expectedId?: string;
	expectedVersion?: string;
	npm?: PluginNpmDistribution;
}

export interface PluginAgentToolRegistration {
	id: string;
	name: string;
	label?: string;
	description: string;
	parameters: Record<string, unknown>;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	/** 允许出现的对话场景 slug（fail-closed：缺省/空 = 所有场景都不激活）。 */
	scope_use?: readonly string[];
	/** 需要的会话能力 slug。 */
	requires?: string[];
	/** 副作用等级（"light" | "heavy"，缺省 = light）。heavy 工具会话内首次调用前需用户确认。 */
	side_effect?: string;
	context?: { conversation?: "summary" | "messages" };
	/**
	 * 该工具带有自渲染卡片（同一插件为它注册了 tool-call slot）。由渲染进程自动探测，
	 * 插件无需声明；宿主据此为它注入可选的 md_intro 参数。见 ADR-0047。
	 */
	rendersCard?: boolean;
}

export interface PluginAgentHookHostRegistration {
	id: string;
	eventName: PluginCodingAgentHookEventName;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	scope_use: readonly string[];
	toolNames?: readonly string[];
}

export type PluginAppActionEffect = "read" | "write" | "execute";

export interface PluginAppActionApproval {
	defaultPresentation: string;
	presentations: Array<{ id: string; title: string; description: string }>;
	presentationByOperation?: Record<string, string>;
	alternativePresentationsByOperation?: Record<string, string[]>;
}

export interface PluginAppActionRegistration {
	id: string;
	publicId?: string;
	title: string;
	summary: string;
	description?: string;
	keywords?: string[];
	effect: PluginAppActionEffect;
	approval?: PluginAppActionApproval;
	inputSchema: Record<string, unknown>;
	examples: Array<{ description: string; input: unknown }>;
	handlerId: string;
	activationId: string;
	hasAssertReady: boolean;
	timeoutMs?: number;
}

export interface PluginAppActionInvocationRequest {
	requestId: string;
	pluginId: string;
	actionId: string;
	localActionId: string;
	handlerId: string;
	settings: Record<string, unknown>;
	input: unknown;
	phase: "assert-ready" | "run";
}

export interface PluginAppActionCancelRequest {
	requestId: string;
}

export interface PluginHandlerInvocationBase {
	requestId: string;
	pluginId: string;
	handlerId: string;
	activationId?: string;
	settings: Record<string, unknown>;
	session: { id: string; cwd: string; scenario: string };
	model: {
		provider: string;
		id: string;
		api: string;
		input: string[];
		contextWindow?: number;
		maxTokens?: number;
	};
	conversation: {
		messages: Array<{ role: string; text: string; timestamp?: number; toolName?: string }>;
		messageCount: number;
	};
	runtime: { activeToolNames: string[]; availableToolNames: string[]; runIndex: number };
}

export interface PluginAgentToolInvocationRequest extends PluginHandlerInvocationBase {
	toolId: string;
	toolName: string;
	input: unknown;
	trigger: { kind: "tool-call"; timestamp: number; toolCallId: string };
}

export interface PluginAgentHookInvocationRequest {
	requestId: string;
	pluginId: string;
	handlerId: string;
	activationId?: string;
	settings: Record<string, unknown>;
	hookId: string;
	session: { id: string; cwd: string; scenario: string };
	event: PluginCodingAgentHookEvent;
}

export interface PluginAgentHandlerReleasedEvent {
	kind: "tool" | "hook" | "continuation" | "system-prompt";
	pluginId: string;
	handlerId: string;
	activationId?: string;
}

export interface PluginContinuationRegistration {
	id: string;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	context?: { conversation?: "summary" | "messages" };
}

export interface PluginContinuationInvocationRequest extends PluginHandlerInvocationBase {
	providerId: string;
	trigger: { kind: "continuation"; timestamp: number };
}

export interface PluginContinuationInvocationResult {
	text: string;
	idempotencyKey?: string;
}

export interface PluginSystemPromptProviderRegistration {
	id: string;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	context?: {
		systemPrompt?: "none" | "blocks" | "rendered" | "full";
		conversation?: "summary" | "messages";
	};
}

export interface SystemPromptBlockInput {
	id: string;
	content: string;
	priority?: number;
	enabled?: boolean;
}

export type PluginDynamicSystemPromptOperation =
	| { type: "addBlock"; block: SystemPromptBlockInput }
	| { type: "replaceBlock"; blockId: string; block: Omit<SystemPromptBlockInput, "id"> }
	| {
			type: "updateBlock";
			blockId: string;
			patch: Partial<Pick<SystemPromptBlockInput, "content" | "priority" | "enabled">>;
	  }
	| { type: "removeBlock"; blockId: string }
	| { type: "setBlockEnabled"; blockId: string; enabled: boolean }
	| { type: "setToolEnabled"; toolName: string; enabled: boolean }
	| { type: "requestContinuation"; result: PluginContinuationInvocationResult };

export interface PluginSystemPromptInvocationRequest extends PluginHandlerInvocationBase {
	providerId: string;
	trigger: { kind: "agent-run"; timestamp: number };
	systemPrompt?: {
		base: { blocks?: SystemPromptBlockView[]; rendered?: string };
		current: { blocks?: SystemPromptBlockView[]; rendered?: string };
	};
}

export interface SystemPromptBlockView extends SystemPromptBlockInput {
	type: string;
	source: { kind: "core" | "plugin"; pluginId?: string };
	priority: number;
	enabled: boolean;
}

export interface PluginHandlerInvocationResult<T> {
	value: T;
	effects: PluginDynamicSystemPromptOperation[];
}

export interface DesktopPluginCapabilityFilesystemApi {
	readDirectory(sessionId: string, path: string): Promise<FsEntry[]>;
	readFile(sessionId: string, path: string): Promise<{ content: string; encoding: "utf8" | "base64" }>;
	readBinaryFile(sessionId: string, path: string): Promise<{ data: string; mimeType: string; size: number }>;
	writeFile(sessionId: string, path: string, content: string, encoding?: "utf8" | "base64"): Promise<void>;
	stat(sessionId: string, path: string): Promise<FsStatResult | null>;
	rename(sessionId: string, oldPath: string, newPath: string): Promise<void>;
	delete(sessionId: string, path: string): Promise<void>;
	move(sessionId: string, sourcePath: string, destinationDirectory: string): Promise<void>;
	createDirectory(sessionId: string, path: string): Promise<void>;
	listFilesRecursive(sessionId: string, path: string): Promise<FsFileRef[]>;
}

export interface DesktopPluginCapabilityGeneralSettingsApi {
	get(sessionId: string): Promise<GeneralSettingsSnapshot>;
	setNotifications(sessionId: string, enabled: boolean): Promise<NotificationsSettingInput>;
	setDefaultExecutionMode(sessionId: string, mode: GeneralExecutionMode): Promise<DefaultExecutionModeSettingInput>;
	setWorkspace(sessionId: string, path: string): Promise<WorkspaceSettingInput>;
}

export interface DesktopPluginCapabilityAgentSettingsApi {
	getExperimental(sessionId: string): Promise<AgentExperimentalSettings>;
	setExperimental(sessionId: string, input: AgentExperimentalSettingsUpdate): Promise<AgentExperimentalSettings>;
}

export interface DesktopPluginCapabilityImApi {
	getStatus(sessionId: string): Promise<ImStatusSnapshot>;
	listLogs(sessionId: string, limit: number): Promise<ImLogEntry[]>;
	setEnabled(sessionId: string, enabled: boolean): Promise<ImRuntimeStatus>;
	restart(sessionId: string): Promise<ImRuntimeStatus>;
	setAgentModel(sessionId: string, modelKey: string | null, reasoningLevel?: string): Promise<ImRuntimeStatus>;
}

export interface DesktopPluginCapabilityAiApi {
	listModels(sessionId: string): Promise<AiModelListResult>;
	complete(sessionId: string, input: AiCompleteInput): Promise<AiCompleteResult>;
}

export interface DesktopPluginCapabilityModelsApi {
	list(sessionId: string): Promise<ModelListResult>;
	getConfig(sessionId: string): Promise<ModelConfigSnapshot>;
	getProvider(sessionId: string, provider: string): Promise<ModelProviderDetail>;
	probe(sessionId: string, provider: string, model: string): Promise<ModelProbeResult>;
	validateModelKey(sessionId: string, modelKey: string, operation?: string): Promise<void>;
	setDefault(sessionId: string, modelKey: string): Promise<ModelDefaultResult>;
	upsertProvider(
		sessionId: string,
		provider: string,
		data: ModelProviderUpsertData,
	): Promise<ModelProviderConfigSnapshot>;
	removeProvider(sessionId: string, provider: string): Promise<void>;
}

export interface DesktopPluginCapabilityMediaApi {
	listProviders(sessionId: string): Promise<MediaProviderDescriptor[]>;
	submit(sessionId: string, input: PluginMediaSubmitRequest): Promise<PluginMediaJob>;
}

export interface DesktopPluginCapabilityJobsApi {
	get(sessionId: string, id: string): Promise<Job>;
	cancel(sessionId: string, id: string): Promise<Job>;
}

export interface DesktopPluginCapabilityArtifactsApi {
	persist(
		sessionId: string,
		input: { artifactId: string; destination: PluginArtifactDestination },
	): Promise<PersistedArtifact>;
	release(sessionId: string, artifactId: string): Promise<void>;
}

export interface DesktopPluginCapabilityMcpApi {
	list(sessionId: string): Promise<McpServerSummary[]>;
	get(sessionId: string, name: string): Promise<McpServerDetail>;
	upsert(sessionId: string, name: string, data: McpServerUpsertData): Promise<McpServerDetail>;
	setEnabled(sessionId: string, name: string, enabled: boolean): Promise<void>;
	remove(sessionId: string, name: string): Promise<void>;
}

export interface DesktopPluginCapabilityBatchTasksApi {
	listProjects(sessionId: string): Promise<BatchProject[]>;
	getProject(sessionId: string, projectId: string): Promise<BatchProject>;
	createProject(sessionId: string, data: BatchProjectCreateData): Promise<BatchProject>;
	updateProject(sessionId: string, projectId: string, data: BatchProjectUpdateData): Promise<BatchProject>;
	deleteProject(sessionId: string, projectId: string): Promise<BatchTaskCommandResult>;
	runTask(sessionId: string, projectId: string, taskId: string): Promise<BatchTaskCommandResult>;
	retryTask(sessionId: string, projectId: string, taskId: string): Promise<BatchTaskCommandResult>;
	stopTask(sessionId: string, projectId: string, taskId: string): Promise<BatchTaskCommandResult>;
	deleteTask(sessionId: string, projectId: string, taskId: string): Promise<BatchTaskCommandResult>;
	resumeTask(sessionId: string, projectId: string, taskId: string): Promise<BatchTaskCommandResult>;
	resumeTaskWithText(
		sessionId: string,
		projectId: string,
		taskId: string,
		text: string,
	): Promise<BatchTaskCommandResult>;
	deleteTaskSession(sessionId: string, projectId: string, taskId: string): Promise<BatchTaskCommandResult>;
	deleteAllTasks(sessionId: string, projectId: string): Promise<BatchTaskCommandResult>;
	startProject(sessionId: string, projectId: string): Promise<BatchTaskCommandResult>;
	stopProject(sessionId: string, projectId: string): Promise<BatchTaskCommandResult>;
	resetProject(sessionId: string, projectId: string): Promise<BatchTaskCommandResult>;
	resetFailedTasks(sessionId: string, projectId: string, taskIds: string[]): Promise<BatchTaskCommandResult>;
}

export interface DesktopPluginCapabilityProjectsApi {
	list(sessionId: string): Promise<ProjectListResult>;
	create(sessionId: string, name: string, path?: string): Promise<ProjectEntry>;
	open(sessionId: string, path: string, name?: string): Promise<ProjectEntry>;
	rename(sessionId: string, path: string, name: string): Promise<ProjectEntry>;
	archive(sessionId: string, path: string): Promise<void>;
	unarchive(sessionId: string, path: string): Promise<void>;
	remove(sessionId: string, path: string): Promise<void>;
}

export interface DesktopPluginCapabilitySessionsApi {
	list(sessionId: string, cwd: string): Promise<SessionHistoryEntry[]>;
	listRuntimeProjects(sessionId: string): Promise<SessionRuntimeProject[]>;
}

export interface DesktopPluginCapabilitySkillsApi {
	list(sessionId: string, cwd?: string): Promise<SkillInfo[]>;
	listInstalled(sessionId: string): Promise<Record<string, InstalledSkill>>;
	setEnabled(sessionId: string, name: string, enabled: boolean): Promise<SkillSetEnabledResult>;
	uninstall(sessionId: string, name: string, type?: SkillType): Promise<void>;
}

export interface DesktopPluginCapabilityShortcutsApi {
	getSettings(sessionId: string): Promise<ShortcutSettings>;
	setBinding(sessionId: string, id: string, shortcut: string): Promise<ShortcutBindingsResult>;
	resetBinding(sessionId: string, id: string): Promise<ShortcutBindingResetResult>;
	resetAllBindings(sessionId: string): Promise<ShortcutBindingsResult>;
	setQuickPanelTrigger(sessionId: string, trigger: QuickPanelTrigger): Promise<QuickPanelSettings>;
	setQuickPanelPostSendBehavior(sessionId: string, behavior: QuickPanelPostSendBehavior): Promise<QuickPanelSettings>;
}

export interface DesktopPluginCapabilityDownloadsApi {
	list(sessionId: string): Promise<CapabilityDownloadItem[]>;
	cancel(sessionId: string, id: string): Promise<void>;
}

export interface DesktopPluginCapabilityUpdaterApi {
	getState(sessionId: string): Promise<UpdaterState>;
	getCurrentVersion(sessionId: string): Promise<string>;
	check(sessionId: string): Promise<UpdaterState>;
	download(sessionId: string): Promise<UpdaterState>;
	install(sessionId: string): Promise<void>;
	dismiss(sessionId: string): Promise<void>;
	cancel(sessionId: string): Promise<void>;
}

export interface DesktopPluginCapabilityKnowledgeApi {
	listBases(sessionId: string): Promise<KnowledgeBase[]>;
	listFileStatuses(sessionId: string): Promise<KnowledgeFileStatuses>;
	isProcessing(sessionId: string): Promise<boolean>;
	getProcessing(sessionId: string): Promise<KnowledgeProcessingSettings>;
	createBase(sessionId: string, name: string): Promise<void>;
	renameBase(sessionId: string, name: string, newName: string): Promise<void>;
	deleteBase(sessionId: string, name: string): Promise<void>;
	addFiles(sessionId: string, kbId: string, paths: string[], move: boolean): Promise<void>;
	deleteEntry(sessionId: string, kbId: string, relPath: string): Promise<void>;
	scanNow(sessionId: string): Promise<KnowledgeScanResult>;
	retryFailed(sessionId: string): Promise<KnowledgeScanResult>;
	setProcessing(sessionId: string, data: KnowledgeProcessingUpdate): Promise<KnowledgeProcessingSettings>;
}

export interface DesktopPluginCapabilitySchedulerApi {
	listTasks(sessionId: string): Promise<SchedulerTask[]>;
	getTask(sessionId: string, taskId: string): Promise<SchedulerTask>;
	listHistory(sessionId: string, taskId: string): Promise<SchedulerExecutionRecord[]>;
	createTask(sessionId: string, data: SchedulerTaskCreateData): Promise<SchedulerTask>;
	updateTask(sessionId: string, taskId: string, data: SchedulerTaskUpdateData): Promise<SchedulerTask>;
	deleteTask(sessionId: string, taskId: string): Promise<SchedulerCommandResult>;
	setEnabled(sessionId: string, taskId: string, enabled: boolean): Promise<SchedulerTask>;
	runTask(sessionId: string, taskId: string): Promise<SchedulerCommandResult>;
	abortTask(sessionId: string, taskId: string): Promise<SchedulerCommandResult>;
}

export interface DesktopPluginCapabilityWebhookApi {
	listEndpoints(sessionId: string): Promise<WebhookEndpoint[]>;
	listProviders(sessionId: string): Promise<WebhookProviderDescriptor[]>;
	createEndpoint(sessionId: string, data: WebhookCreateData): Promise<WebhookEndpoint>;
	updateEndpoint(sessionId: string, id: string, data: WebhookUpdateData): Promise<WebhookEndpoint>;
	deleteEndpoint(sessionId: string, id: string): Promise<void>;
	setEnabled(sessionId: string, id: string, enabled: boolean): Promise<WebhookEndpoint>;
	testEndpoint(sessionId: string, id: string): Promise<WebhookSendResult>;
	sendMessage(sessionId: string, id: string, message: WebhookMessage): Promise<WebhookSendResult>;
}

export interface DesktopPluginSystemApi {
	list(sessionId: string): Promise<InstalledPlugin[]>;
	installFromUrl(sessionId: string, url: string): Promise<InstalledPlugin>;
	installFromPath(
		sessionId: string,
		path: string,
		options?: { grantedPermissions?: string[]; enable?: boolean },
	): Promise<InstalledPlugin>;
	uninstall(sessionId: string, id: string): Promise<void>;
	setEnabled(sessionId: string, id: string, enabled: boolean): Promise<InstalledPlugin>;
	reload(sessionId: string, id: string): Promise<InstalledPlugin>;
}

/** @internal Host bridge used to implement the public plugin-sdk facade. */
export interface DesktopPluginInternalCapabilitiesApi {
	openSession(pluginId: string): Promise<string>;
	closeSession(sessionId: string): Promise<void>;
	agentSettings: DesktopPluginCapabilityAgentSettingsApi;
	ai: DesktopPluginCapabilityAiApi;
	artifacts: DesktopPluginCapabilityArtifactsApi;
	batchTasks: DesktopPluginCapabilityBatchTasksApi;
	filesystem: DesktopPluginCapabilityFilesystemApi;
	generalSettings: DesktopPluginCapabilityGeneralSettingsApi;
	im: DesktopPluginCapabilityImApi;
	jobs: DesktopPluginCapabilityJobsApi;
	mcp: DesktopPluginCapabilityMcpApi;
	media: DesktopPluginCapabilityMediaApi;
	models: DesktopPluginCapabilityModelsApi;
	downloads: DesktopPluginCapabilityDownloadsApi;
	knowledge: DesktopPluginCapabilityKnowledgeApi;
	projects: DesktopPluginCapabilityProjectsApi;
	scheduler: DesktopPluginCapabilitySchedulerApi;
	sessions: DesktopPluginCapabilitySessionsApi;
	shortcuts: DesktopPluginCapabilityShortcutsApi;
	skills: DesktopPluginCapabilitySkillsApi;
	pluginSystem: DesktopPluginSystemApi;
	updater: DesktopPluginCapabilityUpdaterApi;
	webhook: DesktopPluginCapabilityWebhookApi;
}

export interface PluginMediaProviderHostRegistration {
	id: string;
	displayName?: string;
	capabilities: readonly PluginMediaCapability[];
	handlerId: string;
	activationId: string;
	hasGetJob: boolean;
	hasCancelJob: boolean;
}

export interface PluginMediaProviderInvocationRequest {
	requestId: string;
	pluginId: string;
	handlerId: string;
	operation: "submit" | "getJob" | "cancelJob";
	input: PluginMediaProviderSubmitRequest | { jobId: string };
}

export type PluginMediaProviderInvocationResult = { value: PluginMediaProviderJob } | { error: string };

export interface DesktopPluginsApi {
	readonly internalCapabilities: DesktopPluginInternalCapabilitiesApi;
	/** 全部已装插件；工作台与 UI 贡献用它。工作模式不再隐藏任何插件。 */
	list(): Promise<InstalledPlugin[]>;
	/** 与 `list()` 等价的完整清单；能力市场「我的」在用。 */
	listAll(): Promise<InstalledPlugin[]>;
	installFromArchive(archiveBuffer: ArrayBuffer, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	installFromUrl(url: string, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	/** Install from a local zip absolute path (ADR-0042). */
	installFromPath(path: string, options?: PluginInstallOptions): Promise<InstalledPlugin>;
	uninstall(id: string): Promise<void>;
	setEnabled(id: string, enabled: boolean): Promise<void>;
	grantPermissions(id: string, permissions: PluginPermission[]): Promise<InstalledPlugin>;
	revokePermissions(id: string, permissions: PluginPermission[]): Promise<InstalledPlugin>;
	/** Enable declared command names for a plugin (intersected with declaredCommands). */
	grantCommands(id: string, names: string[]): Promise<InstalledPlugin>;
	/** Disable declared command names for a plugin. */
	revokeCommands(id: string, names: string[]): Promise<InstalledPlugin>;
	/** Run an allowed command for a plugin via the main process (execFile, no shell). */
	runCommand(
		sessionId: string,
		file: string,
		args?: string[],
		options?: PluginCommandRunOptions,
	): Promise<PluginCommandRunResult>;
	/** Start an allowed long-lived command (ADR-0054). No shell; own process group. */
	spawnCommand(
		sessionId: string,
		file: string,
		args?: string[],
		options?: PluginCommandSpawnOptions,
	): Promise<PluginCommandSpawnResult>;
	/** SIGTERM the spawned process tree (SIGKILL after a grace period). */
	stopCommandSpawn(sessionId: string, spawnId: string): Promise<void>;
	/** Liveness, port and recent output for a spawn started by this plugin. */
	getCommandSpawnStatus(sessionId: string, spawnId: string): Promise<PluginCommandSpawnStatus>;
	/** Subscribe to spawn exit events (all plugins; filter by pluginId/spawnId). */
	onCommandSpawnExit(handler: (event: PluginCommandSpawnExitEvent) => void): () => void;
	/** 主进程离屏窗口截图（真实渲染管线，`capture.offscreen` 权限）。 */
	offscreenCapture(pluginId: string, options: PluginOffscreenCaptureOptions): Promise<PluginOffscreenCaptureResult>;
	/** 释放 sessionKey 对应的离屏窗口。幂等。 */
	offscreenRelease(pluginId: string, sessionKey: string): Promise<void>;
	reload(id: string): Promise<InstalledPlugin>;
	/**
	 * 开启 dev 热更新：把插件 dev 链接到 projectDir（资源改从工程 dist 加载），
	 * 宿主常驻 `vite build --watch` 并监听 dist，产物变化自动重载。要求插件已安装过一次。
	 */
	startDevWatch(sessionId: string, id: string, projectDir: string): Promise<InstalledPlugin>;
	/** 关闭 dev 热更新：停掉 vite watch 与文件监听，资源回落已安装目录。 */
	stopDevWatch(sessionId: string, id: string): Promise<void>;
	/**
	 * Mark a plugin as contribution-mode-gated (ADR-0041). Until
	 * {@link setContributionMode} enables it, agent contributions are stripped.
	 */
	registerModeGate(pluginId: string): Promise<void>;
	/** Enable/disable a mode-gated plugin's agent contributions (ADR-0041). */
	setContributionMode(pluginId: string, active: boolean): Promise<void>;
	beginAgentContributionsLoad(pluginId: string, activationId: string): Promise<void>;
	commitAgentContributionsLoad(pluginId: string, activationId: string): Promise<void>;
	registerAgentTool(pluginId: string, registration: PluginAgentToolRegistration): Promise<void>;
	unregisterAgentTool(pluginId: string, toolId: string, activationId?: string): Promise<void>;
	registerAgentHook(pluginId: string, registration: PluginAgentHookHostRegistration): Promise<void>;
	unregisterAgentHook(pluginId: string, hookId: string, activationId?: string): Promise<void>;
	clearAgentContributions(pluginId: string, activationId?: string): Promise<void>;
	onAgentToolRequest(handler: (request: PluginAgentToolInvocationRequest) => void): () => void;
	respondAgentTool(requestId: string, result: unknown): Promise<void>;
	onAgentHookRequest(handler: (request: PluginAgentHookInvocationRequest) => void): () => void;
	onAgentHandlerReleased(handler: (event: PluginAgentHandlerReleasedEvent) => void): () => void;
	respondAgentHook(requestId: string, result: unknown): Promise<void>;
	registerAppAction(pluginId: string, registration: PluginAppActionRegistration): Promise<void>;
	commitAppActionActivation(pluginId: string, activationId: string): Promise<void>;
	abortAppActionActivation(pluginId: string, activationId: string): Promise<void>;
	unregisterAppAction(pluginId: string, actionId: string, activationId?: string): Promise<void>;
	onAppActionRequest(handler: (request: PluginAppActionInvocationRequest) => void): () => void;
	onAppActionCancel(handler: (request: PluginAppActionCancelRequest) => void): () => void;
	respondAppAction(requestId: string, result: unknown): Promise<void>;
	registerContinuationProvider(pluginId: string, registration: PluginContinuationRegistration): Promise<void>;
	unregisterContinuationProvider(pluginId: string, providerId: string, activationId?: string): Promise<void>;
	onContinuationRequest(handler: (request: PluginContinuationInvocationRequest) => void): () => void;
	respondContinuation(
		requestId: string,
		result:
			| PluginHandlerInvocationResult<PluginContinuationInvocationResult | null>
			| {
					error: string;
			  },
	): Promise<void>;
	registerSystemPromptProvider(pluginId: string, registration: PluginSystemPromptProviderRegistration): Promise<void>;
	unregisterSystemPromptProvider(pluginId: string, providerId: string, activationId?: string): Promise<void>;
	onSystemPromptRequest(handler: (request: PluginSystemPromptInvocationRequest) => void): () => void;
	respondSystemPrompt(
		requestId: string,
		result: PluginHandlerInvocationResult<PluginDynamicSystemPromptOperation[]> | { error: string },
	): Promise<void>;
	registerMediaProvider(pluginId: string, registration: PluginMediaProviderHostRegistration): Promise<void>;
	unregisterMediaProvider(pluginId: string, providerId: string, activationId: string): Promise<void>;
	onMediaProvidersChanged(handler: () => void): () => void;
	onMediaProviderRequest(handler: (request: PluginMediaProviderInvocationRequest) => void): () => void;
	respondMediaProvider(requestId: string, result: PluginMediaProviderInvocationResult): Promise<void>;
	uploadMediaProviderInput<T = unknown>(
		requestId: string,
		inputId: string,
		request: PluginMediaInputUploadRequest,
	): Promise<PluginMediaTransferResponse<T>>;
	/** Effective setting values for a plugin (schema defaults merged with stored). */
	getSettings(id: string): Promise<Record<string, unknown>>;
	/** Persist setting values for a plugin (merged over existing). */
	setSettings(id: string, values: Record<string, unknown>): Promise<void>;
	/** Subscribe to setting changes for any plugin. Returns an unsubscribe fn. */
	onSettingsChanged(listener: (payload: { pluginId: string; values: Record<string, unknown> }) => void): () => void;
	/** Fired when plugins are installed/uninstalled/enabled/reloaded (host should re-load remotes). */
	onPluginsChanged(listener: (event?: PluginsChangedEvent) => void): () => void;
	networkRequest<T = unknown>(sessionId: string, request: PluginNetworkRequest): Promise<PluginNetworkResponse<T>>;
	/** 带登录身份打 Vetta 服务端；仅 official 插件的 session 会被主进程放行（ADR-0056）。 */
	gatewayRequest<T = unknown>(sessionId: string, request: PluginGatewayRequest): Promise<PluginGatewayResponse<T>>;
	storageReadJson<T>(sessionId: string, key: string): Promise<T | null>;
	storageWriteJson(sessionId: string, key: string, value: unknown): Promise<void>;
	storageList(sessionId: string, prefix?: string): Promise<string[]>;
	storageReadFile(sessionId: string, path: string): Promise<string | null>;
	storageWriteFile(sessionId: string, path: string, data: string): Promise<void>;
	storagePutBlob(sessionId: string, input: PluginPutBlobInput): Promise<PluginStoredBlobRef>;
	storagePutBlobFromFile(sessionId: string, input: PluginPutBlobFromFileInput): Promise<PluginStoredBlobRef>;
	storageReadBlob(sessionId: string, id: string): Promise<PluginStoredBlob | null>;
	storageGetBlobRef(sessionId: string, id: string): Promise<PluginStoredBlobRef | null>;
}

export type PluginNetworkBody =
	| { type: "json"; value: unknown }
	| {
			type: "multipart";
			fields?: Record<string, string>;
			files?: Array<{
				fieldName: string;
				fileName: string;
				mimeType: string;
				data: string;
			}>;
	  };

export interface PluginNetworkRequest {
	url: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	headers?: Record<string, string>;
	body?: PluginNetworkBody;
	responseType?: "json" | "text" | "base64";
	timeoutMs?: number;
}

export interface PluginNetworkResponse<T = unknown> {
	ok: boolean;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: T;
}

/** 相对 `/api/v1` 的路径；服务端地址与 JWT 由主进程注入（ADR-0056）。 */
export interface PluginGatewayRequest {
	path: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
	timeoutMs?: number;
}

/** 业务信封已由主进程拆开；配额用尽等业务失败也走这里而非抛异常。 */
export interface PluginGatewayResponse<T = unknown> {
	ok: boolean;
	status: number;
	code: number;
	message: string;
	data?: T;
}

export interface PluginPutBlobInput {
	id?: string;
	data: string;
	mimeType: string;
}

export interface PluginStoredBlobRef {
	id: string;
	url: string;
	mimeType: string;
}

export interface PluginStoredBlob {
	data: string;
	mimeType: string;
}

export interface PluginCommandRunOptions {
	cwd?: string;
	env?: Record<string, string>;
	timeoutMs?: number;
}

export interface PluginCommandRunResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

export interface PluginCommandSpawnOptions {
	cwd?: string;
	env?: Record<string, string>;
	/** Host allocates a free port and substitutes `{{PORT}}` in args/env values. */
	allocatePort?: boolean;
}

export interface PluginCommandSpawnResult {
	spawnId: string;
	pid: number;
	/** Present when `allocatePort` was requested. */
	port?: number;
}

export interface PluginCommandSpawnExit {
	exitCode: number | null;
	signal: string | null;
}

export interface PluginCommandSpawnStatus {
	running: boolean;
	pid: number;
	port?: number;
	exit?: PluginCommandSpawnExit;
	/** Ring-buffered combined stdout+stderr tail (~64KB). */
	recentOutput: string;
}

export interface PluginCommandSpawnExitEvent extends PluginCommandSpawnExit {
	pluginId: string;
	spawnId: string;
}

export interface PluginOffscreenCaptureOptions {
	url: string;
	width: number;
	height: number;
	/** 同 key 串行复用同一个离屏窗口（url 未变时跳过重新加载）。 */
	sessionKey?: string;
	/** 页面加载/复用后注入执行的脚本（如 postMessage 切路由）。 */
	prepareScript?: string;
	/** 轮询到真值才截图。 */
	readyExpression?: string;
	settleMs?: number;
	/** 截图同一时刻对页面求值，结果经 JSON 回传到 `probe`。求值失败不影响截图。 */
	probeScript?: string;
	timeoutMs?: number;
	format?: "jpeg" | "png";
	quality?: number;
}

export interface PluginOffscreenCaptureResult {
	dataUrl: string;
	/** 实际设备像素比：位图物理像素 = CSS 尺寸 × 此值。 */
	scaleFactor: number;
	/** `probeScript` 的求值结果；未传、抛错或不可序列化时为 undefined。 */
	probe?: unknown;
}

import type { FsEntry, FsFileRef, FsStatResult } from "../fs-types.js";
