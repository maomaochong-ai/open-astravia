import type {
	AgentExperimentalSettings,
	AgentExperimentalSettingsUpdate,
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
	KnowledgeBase,
	KnowledgeFileStatuses,
	KnowledgeProcessingSettings,
	KnowledgeProcessingUpdate,
	KnowledgeScanResult,
	McpServerDetail,
	McpServerSummary,
	McpServerUpsertData,
	ModelConfigSnapshot,
	ModelDefaultResult,
	ModelListResult,
	ModelProbeResult,
	ModelProviderConfigSnapshot,
	ModelProviderDetail,
	ModelProviderUpsertData,
	NotificationsSettingInput,
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

export type PluginPermission =
	| "ui.slot.global"
	| "ui.slot.file-preview"
	| "ui.slot.activity-tab"
	| "ui.slot.input-action"
	| "ui.slot.message"
	| "ui.slot.tool-call"
	| "ui.slot.turn-card"
	| "ui.shortcuts.register"
	| "ui.file-explorer.decorations"
	| "ui.file-explorer.context-menu"
	| "ui.file-explorer.toolbar"
	| "workspace.read"
	| "agent.session.read"
	| "agent.session.write"
	| "agent.command.run"
	| "agent.systemPrompt.read"
	| "agent.systemPrompt.write"
	| "agent.systemPrompt.fullControl"
	| "agent.skills.control"
	| "agent.mcp.control"
	| "agent.tools.control"
	| "agent.tools.register"
	| "agent.toolHandler.execute"
	| "agent.state.read"
	| "agent.state.write"
	| "agent.continuation.register"
	| "agent.runtime.configure"
	| "app.actions.register"
	| "app.actionHandler.execute"
	| "fs.read"
	| "fs.write"
	| "network.fetch"
	| "storage.read"
	| "storage.write"
	| "settings.read"
	| "settings.write";

/**
 * A single declarative setting a plugin contributes via plugin.json's
 * `contributes.settings`. The host renders a form field from it (VSCode-style)
 * and persists the value namespaced by plugin id. `secret` masks the input but
 * stores plaintext, consistent with how models config stores apiKey.
 */
export interface PluginSettingSchema {
	key: string;
	/**
	 * `desc` is a read-only informational item: it stores no value and renders
	 * its `description` as a note (URLs become clickable external links). Useful
	 * with `visibleWhen` to show provider-specific guidance.
	 */
	type: "string" | "number" | "boolean" | "enum" | "secret" | "desc";
	/** Required for input types; optional for `desc` (which is text-only). */
	title?: string;
	description?: string;
	default?: string | number | boolean;
	/** Allowed values when type is "enum". */
	enum?: string[];
	/**
	 * Conditional visibility: only render this field when the setting named
	 * `key` currently holds one of the values in `in`. Lets a plugin show
	 * different fields per selected provider/mode.
	 */
	visibleWhen?: { key: string; in: string[] };
}

export type PluginMcpServerConfig =
	| {
			type?: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
			cwd?: string;
			disabled?: boolean;
			autoApprove?: string[];
			startupTimeout?: number;
			debug?: boolean;
			displayName?: string;
			description?: string;
			/** 该 server 的工具允许出现的工作模式 slug（agent_mode 轴，缺省/空 = 通用）。见 ADR-0046。 */
			agent_mode?: string | string[];
	  }
	| {
			type: "http";
			url: string;
			headers?: Record<string, string>;
			oauthClientId?: string;
			oauthDeviceFlow?: boolean;
			oauthScopes?: string;
			disabled?: boolean;
			autoApprove?: string[];
			startupTimeout?: number;
			debug?: boolean;
			displayName?: string;
			description?: string;
			/** 该 server 的工具允许出现的工作模式 slug（agent_mode 轴，缺省/空 = 通用）。见 ADR-0046。 */
			agent_mode?: string | string[];
	  };

export interface PluginAgentManifest {
	systemPrompt?: {
		/**
		 * Plugin-packaged prompt contribution file paths. Main-process aggregation
		 * resolves these relative to the installed plugin root.
		 */
		promptPaths?: string[];
	};
	/** Plugin-packaged skill files or directories to add to the agent resource graph. */
	skillPaths?: string[];
	/**
	 * Plugin-scoped MCP: relative path to `.mcp.json` or inline server map.
	 * Requires `agent.mcp.control`. Not written to user mcp.json.
	 */
	mcpServers?: string | Record<string, PluginMcpServerConfig>;
	/** Declarative tool visibility policy. Names are tool ids after registration. */
	toolPolicy?: {
		allow?: string[];
		deny?: string[];
	};
}

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	pluginApiVersion: string;
	entry: string;
	runtime?: "esm" | "module-federation";
	moduleFederation?: {
		remoteName: string;
		expose: string;
	};
	agent?: PluginAgentManifest;
	styles?: string[];
	permissions?: PluginPermission[];
	/**
	 * Executable names this plugin may run via `ctx.command.run` (granularity =
	 * binary name, e.g. `["git"]`). Anything not declared is hard-rejected. The
	 * user toggles each declared command on/off in plugin settings.
	 */
	commands?: string[];
	contributes?: {
		settings?: PluginSettingSchema[];
	};
	description?: string;
	author?: string;
	/**
	 * 插件图标，三态口径（与能力市场统一）：
	 * 省略 = 用默认图标；`solar:xxx-bold` 等 Iconify 名与 `http(s)://` 外链原样透传给渲染层；
	 * 其余按包内相对路径处理，宿主转成带 cache key 的 `vetta-plugin://` URL。
	 */
	icon?: string;
	/**
	 * 声明式引导词：开新会话欢迎页主动建议的提示语。点击即以该文本立即发起一轮。
	 * 与命令式 `ctx.ui.register*` 不同——纯静态清单数据、无权限位、无运行时注册（ADR-0003）。
	 */
	guidingWords?: string[];
	/**
	 * 缺译时的回退 locale（fallback 链：当前 locale → defaultLocale → 裸 key）。
	 * 省略默认 "zh"（与宿主一致，见 ADR-0033）。译文文件本身在 `locales/<lang>.json`，
	 * 由宿主加载、不在 manifest 内联。
	 */
	defaultLocale?: string;
	/**
	 * When hardIsolation is true, agent contributions stay stripped until the
	 * matching input-action mode is toggled on (ADR-0041). Declared in manifest
	 * so the gate applies before the plugin UI activates.
	 */
	contributionMode?: {
		hardIsolation?: boolean;
	};
	/**
	 * 插件级工作模式白名单（agent_mode 轴，见 ADR-0046）。声明后，白名单外的工作模式下整个插件
	 * 不可见（agent 贡献 + UI/bundle 均不加载）。缺省/空 = 全局通用。plugin.json 里可写 string | string[]。
	 */
	agent_mode?: string | string[];
}

/** 一份扁平 catalog：翻译 key → 本地化字符串。 */
export type PluginLocaleCatalog = Record<string, string>;
/** 插件随包发的全部 catalog，按 locale code 归集（如 "zh"、"en"）。 */
export type PluginLocales = Record<string, PluginLocaleCatalog>;

/**
 * Dev 热更新（插件工作台）：内存态 dev 链接快照，不落注册表。
 * 存在即表示该插件资源正从开发工程目录（而非安装目录）加载。
 */
export interface PluginDevWatchState {
	/** 开发工程根目录（含 plugin.json 与 dist/）。 */
	projectDir: string;
	/** starting = vite watch 已拉起但未产出首个构建；error 详见 error 字段。 */
	status: "starting" | "running" | "error";
	error?: string;
}

export type PluginTrustLevel = "official" | "community" | "local";

export interface InstalledPlugin {
	id: string;
	name: string;
	version: string;
	activeVersion: string;
	pluginApiVersion: string;
	runtime: "esm" | "module-federation";
	entryUrl: string;
	moduleFederation?: {
		remoteName: string;
		expose: string;
	};
	agent?: PluginAgentManifest;
	/** 插件级工作模式白名单（agent_mode 轴，见 ADR-0046）。缺省/空 = 全局通用。 */
	agent_mode?: string | string[];
	styleUrls: string[];
	permissions: PluginPermission[];
	grantedPermissions: PluginPermission[];
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
	source: "archive" | "remote" | "system";
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
	source?: "archive" | "remote";
	grantedPermissions?: PluginPermission[];
	/** When true, enable the plugin after install (default false for GUI parity; agent path may set true). */
	enable?: boolean;
	/** Expected sha256 of the archive, from the market entry. Omitted for entries uploaded before digests existed. */
	expectedSha256?: string;
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
	/** 允许出现的工作模式 slug（agent_mode 轴，缺省/空 = 通用）。见 ADR-0046。 */
	agent_mode?: readonly string[];
	context?: { conversation?: "summary" | "messages" };
	/**
	 * 该工具带有自渲染卡片（同一插件为它注册了 tool-call slot）。由渲染进程自动探测，
	 * 插件无需声明；宿主据此为它注入可选的 md_intro 参数。见 ADR-0047。
	 */
	rendersCard?: boolean;
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
	batchTasks: DesktopPluginCapabilityBatchTasksApi;
	filesystem: DesktopPluginCapabilityFilesystemApi;
	generalSettings: DesktopPluginCapabilityGeneralSettingsApi;
	im: DesktopPluginCapabilityImApi;
	mcp: DesktopPluginCapabilityMcpApi;
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

export interface DesktopPluginsApi {
	readonly internalCapabilities: DesktopPluginInternalCapabilitiesApi;
	list(): Promise<InstalledPlugin[]>;
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
		pluginId: string,
		file: string,
		args?: string[],
		options?: PluginCommandRunOptions,
	): Promise<PluginCommandRunResult>;
	reload(id: string): Promise<InstalledPlugin>;
	/**
	 * 开启 dev 热更新：把插件 dev 链接到 projectDir（资源改从工程 dist 加载），
	 * 宿主常驻 `vite build --watch` 并监听 dist，产物变化自动重载。要求插件已安装过一次。
	 */
	startDevWatch(id: string, projectDir: string): Promise<InstalledPlugin>;
	/** 关闭 dev 热更新：停掉 vite watch 与文件监听，资源回落已安装目录。 */
	stopDevWatch(id: string): Promise<void>;
	/**
	 * Mark a plugin as contribution-mode-gated (ADR-0041). Until
	 * {@link setContributionMode} enables it, agent contributions are stripped.
	 */
	registerModeGate(pluginId: string): Promise<void>;
	/** Enable/disable a mode-gated plugin's agent contributions (ADR-0041). */
	setContributionMode(pluginId: string, active: boolean): Promise<void>;
	beginAgentContributionsLoad(pluginId: string, activationId: string): Promise<void>;
	registerAgentTool(pluginId: string, registration: PluginAgentToolRegistration): Promise<void>;
	unregisterAgentTool(pluginId: string, toolId: string, activationId?: string): Promise<void>;
	clearAgentContributions(pluginId: string, activationId?: string): Promise<void>;
	onAgentToolRequest(handler: (request: PluginAgentToolInvocationRequest) => void): () => void;
	respondAgentTool(requestId: string, result: unknown): Promise<void>;
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
	/** Effective setting values for a plugin (schema defaults merged with stored). */
	getSettings(id: string): Promise<Record<string, unknown>>;
	/** Persist setting values for a plugin (merged over existing). */
	setSettings(id: string, values: Record<string, unknown>): Promise<void>;
	/** Subscribe to setting changes for any plugin. Returns an unsubscribe fn. */
	onSettingsChanged(listener: (payload: { pluginId: string; values: Record<string, unknown> }) => void): () => void;
	/** Fired when plugins are installed/uninstalled/enabled/reloaded (host should re-load remotes). */
	onPluginsChanged(listener: () => void): () => void;
	networkRequest<T = unknown>(sessionId: string, request: PluginNetworkRequest): Promise<PluginNetworkResponse<T>>;
	storageReadJson<T>(sessionId: string, key: string): Promise<T | null>;
	storageWriteJson(sessionId: string, key: string, value: unknown): Promise<void>;
	storageList(sessionId: string, prefix?: string): Promise<string[]>;
	storageReadFile(sessionId: string, path: string): Promise<string | null>;
	storageWriteFile(sessionId: string, path: string, data: string): Promise<void>;
	storagePutBlob(sessionId: string, input: PluginPutBlobInput): Promise<PluginStoredBlobRef>;
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

import type { FsEntry, FsFileRef, FsStatResult } from "../fs-types.js";
