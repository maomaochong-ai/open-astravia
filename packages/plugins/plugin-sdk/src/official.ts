import type { PluginPermission } from "./permissions.js";

export interface PluginOfficialGeneralSettings {
	workspacePath: string;
	defaultExecutionMode?: "sandbox" | "full-access";
	notificationsEnabled: boolean;
	debugMode: boolean;
	sandbox: unknown;
}

export type PluginOfficialGeneralSettingsUpdate =
	| { operation: "set-notifications"; enabled: boolean }
	| { operation: "set-execution-mode"; mode: "sandbox" | "full-access" }
	| { operation: "set-workspace"; path: string };

export interface PluginOfficialExperimentalSettings {
	vettaCli: boolean;
	promptPrediction: boolean;
	agentSkills: boolean;
}

export interface PluginOfficialDownloadItem {
	id: string;
	url: string;
	filename: string;
	path: string;
	totalBytes: number;
	receivedBytes: number;
	status: "queued" | "downloading" | "paused" | "completed" | "failed" | "canceled";
	error?: string;
	createdAt: number;
	completedAt?: number;
	speedBytesPerSec?: number;
}

export interface PluginOfficialUpdaterState {
	phase: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
	currentVersion: string;
	latestVersion?: string;
	releaseNote?: string;
	progress?: number;
	downloadedBytes?: number;
	totalBytes?: number;
	assetFileName?: string;
	error?: string;
}

export type PluginOfficialWebhookKind = "feishu" | "dingtalk";

export interface PluginOfficialWebhookEndpoint {
	id: string;
	kind: PluginOfficialWebhookKind;
	name: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	urlMask?: string;
	hasSignSecret?: boolean;
}

export interface PluginOfficialWebhookProvider {
	kind: PluginOfficialWebhookKind;
	displayName: string;
	iconClass?: string;
}

export interface PluginOfficialWebhookCreateInput {
	kind: PluginOfficialWebhookKind;
	name: string;
	webhookUrl: string;
	signSecret?: string;
	enabled?: boolean;
}

export interface PluginOfficialWebhookUpdateInput {
	name?: string;
	enabled?: boolean;
	webhookUrl?: string;
	signSecret?: string;
}

export interface PluginOfficialWebhookMessage {
	title?: string;
	text: string;
	level?: "info" | "warn" | "error" | "success";
}

export interface PluginOfficialWebhookSendResult {
	ok: boolean;
	error?: string;
}

export interface PluginOfficialSkillInfo {
	name: string;
	alias?: string;
	description: string;
	source: string;
	type: "skill" | "scene";
}

export type PluginOfficialInstalledSkill = {
	name: string;
	version: string;
	installedAt: string;
	source: "market" | "custom";
	enabled: boolean;
	type?: "skill" | "scene";
	alias?: string;
	marketDescription?: string;
	description?: string;
};

export interface PluginOfficialShortcutBinding {
	id: string;
	defaultShortcut: string;
	shortcut: string;
	isDefault: boolean;
}

export interface PluginOfficialQuickPanelSettings {
	trigger: "none" | "mod" | "alt" | "shift";
	postSendBehavior: "foreground" | "background";
}

export interface PluginOfficialImStatus {
	enabled: boolean;
	transport: string;
	agentModel: { provider: string; model: string; reasoningLevel?: string } | null;
	wechatBound: boolean;
	feishuAppId: string | null;
	runtime: unknown;
}

export interface PluginOfficialImLog {
	level: string;
	msg: string;
	time: string;
	fields?: Record<string, unknown>;
}

export interface PluginOfficialMcpServerSummary {
	name: string;
	type: "http" | "stdio";
	disabled: boolean;
	command?: string;
	url?: string;
}

export interface PluginOfficialMcpServerDetail {
	name: string;
	type?: "http" | "stdio";
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
	disabled?: boolean;
	autoApprove?: string[];
	startupTimeout?: number;
	debug?: boolean;
}

export type PluginOfficialMcpUpsertData =
	| {
			type?: "stdio";
			command?: string;
			args?: string[];
			env?: Record<string, string>;
			cwd?: string;
			disabled?: boolean;
			autoApprove?: string[];
			startupTimeout?: number;
			debug?: boolean;
	  }
	| {
			type: "http";
			url?: string;
			headers?: Record<string, string>;
			disabled?: boolean;
			autoApprove?: string[];
			startupTimeout?: number;
			debug?: boolean;
	  };

export type PluginOfficialExecutionMode = "inherit" | "sandbox" | "full-access";

export interface PluginOfficialSelectedSkill {
	name: string;
	alias?: string;
	type: "skill" | "scene";
}

export interface PluginOfficialBatchProjectCreateData {
	name: string;
	prompt: string;
	modelKey?: string;
	folders: string[];
	concurrency: number;
	executionMode?: PluginOfficialExecutionMode;
	artifactPatterns?: string[];
	notifyEnabled?: boolean;
	timeoutMinutes?: number;
	skill?: PluginOfficialSelectedSkill;
}

export interface PluginOfficialBatchProjectUpdateData {
	name?: string;
	prompt?: string;
	modelKey?: string;
	concurrency?: number;
	executionMode?: PluginOfficialExecutionMode;
	artifactPatterns?: string[];
	notifyEnabled?: boolean;
	timeoutMinutes?: number;
	newFolders?: string[];
	skill?: PluginOfficialSelectedSkill | null;
}

export interface PluginOfficialSchedulerTaskCreateData {
	name: string;
	prompt: string;
	cron: string;
	isOnce: boolean;
	enabled?: boolean;
	cwd: string;
	modelKey?: string;
	executionMode?: PluginOfficialExecutionMode;
	skill?: PluginOfficialSelectedSkill;
}

export interface PluginOfficialSchedulerTaskUpdateData {
	name?: string;
	prompt?: string;
	cron?: string;
	isOnce?: boolean;
	enabled?: boolean;
	cwd?: string;
	modelKey?: string | null;
	executionMode?: PluginOfficialExecutionMode;
	skill?: PluginOfficialSelectedSkill | null;
}

export interface PluginOfficialModelSummary {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
}

export interface PluginOfficialProviderSummary {
	id: string;
	displayName: string;
	baseUrl?: string;
	api?: string;
	hasApiKey: boolean;
	/** 图标 symbol；配合 `ProviderIcon` 解析为内置图标，无则不画图标。 */
	icon?: string;
	/**
	 * true = 来自登录后服务端下发的远程目录（如 Vetta Go），凭据是账号登录态而非本地
	 * API Key，因此不会出现在本地模型配置里，也不可用 `upsertProvider` / `removeProvider` 改。
	 */
	remote?: boolean;
	modelCount: number;
	models: PluginOfficialModelSummary[];
}

export interface PluginOfficialProviderDetail {
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	displayName?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	models?: Array<{
		id: string;
		name?: string;
		api?: string;
		reasoning?: boolean;
		contextWindow?: number;
		maxTokens?: number;
	}>;
}

export interface PluginOfficialProviderUpsertData {
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	displayName?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	models?: Array<{
		id: string;
		name?: string;
		api?: string;
		reasoning?: boolean;
		contextWindow?: number;
		maxTokens?: number;
	}>;
}

export interface PluginOfficialProjectEntry {
	path: string;
	name?: string;
}

export interface PluginOfficialPluginSummary {
	id: string;
	name: string;
	version: string;
	enabled: boolean;
	required: boolean;
	source: string;
	permissions: string[];
	description?: string;
	rootPath?: string;
	devWatch?: unknown;
}

export interface PluginOfficialPluginChangedEvent {
	reason?: string;
	pluginId?: string;
}

export interface PluginOfficialSaveCopyOptions {
	defaultFileName?: string;
	title?: string;
	filters?: Array<{ name: string; extensions: string[] }>;
}

/** `official.dialog.openFiles` 的选项。 */
export interface PluginOfficialOpenFilesOptions {
	title?: string;
	filters?: Array<{ name: string; extensions: string[] }>;
	/** 允许多选，默认单选。 */
	multiple?: boolean;
	/** 单个文件的字节上限，超过则抛错。默认 64MB。 */
	maxBytes?: number;
}

/** 用户在文件对话框里选中的一个文件，内容随选择一起回传。 */
export interface PluginOfficialOpenedFile {
	path: string;
	name: string;
	/** base64 编码的文件内容。 */
	data: string;
}

export interface PluginOfficialKnowledgeBase {
	id: string;
	name: string;
	updatedAt: number;
	isDefault: boolean;
	nodes: unknown[];
}

export interface PluginOfficialKnowledgeProcessingSettings {
	enabled?: boolean;
	pollIntervalMinutes?: number;
	processingModelKey?: string;
	processingModelReasoningLevel?: string;
	agentConcurrency?: number;
	ocrConcurrency?: number;
}

/** 由 `official.sessions.create` 新建的后台会话句柄。 */
export interface PluginOfficialSessionHandle {
	/** 进程内 runtime id，用于 prompt / abort / subscribe。重启后失效。 */
	sessionId: string;
	/** 会话文件绝对路径，跨重启稳定，用于持久化与跳转。 */
	sessionPath: string;
	/** 实际运行目录（「对话」项目会落到 per-session 子目录，见 ADR-0007）。 */
	cwd?: string;
}

/** 会话运行态变化广播（按 sessionPath 标识，跨重启稳定）。 */
export interface PluginOfficialSessionRunningEvent {
	sessionPath: string;
	running: boolean;
	sessionId?: string;
}

/**
 * 会话文件此刻允许做什么。
 *
 * 同一份会话文件可能正被另一个运行时占用、或已不可读，宿主自己点会话时就是按这几
 * 位分流的（可续聊 / 只读查看 / 完全打不开）。插件在跳转前必须先看它，否则会把用户
 * 送进一个打不开的会话，且失败发生在导航之后、很难解释。
 */
export interface PluginOfficialSessionAccess {
	/** 能否读取历史。为 false 时连只读查看都不行。 */
	readHistory: boolean;
	/** 能否在对话页续聊。 */
	interactiveResume: boolean;
	rename: boolean;
	delete: boolean;
}

/** 会话历史条目（`official.sessions.list` 返回），按 `modifiedAt` 倒序。 */
export interface PluginOfficialSessionSummary {
	path: string;
	cwd?: string;
	firstMessage?: string;
	modifiedAt?: number;
	access: PluginOfficialSessionAccess;
}

/**
 * 导航目标。多数目标只要 `target`；`target: "new-session"` 这类带参数的目标另需
 * `cwd`（项目绝对路径），缺了会被宿主拒绝而不是跳到一个空页面。
 */
export interface PluginOfficialNavigationOpenInput {
	target: string;
	tab?: string;
	section?: string;
	/** 仅 `target: "new-session"` 使用：要新建会话的项目目录。 */
	cwd?: string;
}

/** 仅宿主验证为官方来源的插件可以调用；普通插件调用时由宿主拒绝。 */
export interface PluginOfficialApi {
	general: {
		getSettings(): Promise<PluginOfficialGeneralSettings>;
		setSettings(input: PluginOfficialGeneralSettingsUpdate): Promise<PluginOfficialGeneralSettingsUpdate>;
	};
	agent: {
		getExperimental(): Promise<PluginOfficialExperimentalSettings>;
		setExperimental(input: Partial<PluginOfficialExperimentalSettings>): Promise<PluginOfficialExperimentalSettings>;
	};
	downloads: {
		list(): Promise<PluginOfficialDownloadItem[]>;
		cancel(id: string): Promise<void>;
	};
	updater: {
		getState(): Promise<PluginOfficialUpdaterState>;
		getCurrentVersion(): Promise<string>;
		check(): Promise<PluginOfficialUpdaterState>;
		download(): Promise<PluginOfficialUpdaterState>;
		install(): Promise<void>;
		dismiss(): Promise<void>;
		cancel(): Promise<void>;
	};
	webhook: {
		list(): Promise<PluginOfficialWebhookEndpoint[]>;
		listProviders(): Promise<PluginOfficialWebhookProvider[]>;
		create(input: PluginOfficialWebhookCreateInput): Promise<PluginOfficialWebhookEndpoint>;
		update(id: string, input: PluginOfficialWebhookUpdateInput): Promise<PluginOfficialWebhookEndpoint>;
		setEnabled(id: string, enabled: boolean): Promise<PluginOfficialWebhookEndpoint>;
		delete(id: string): Promise<void>;
		test(id: string): Promise<PluginOfficialWebhookSendResult>;
		send(id: string, message: PluginOfficialWebhookMessage): Promise<PluginOfficialWebhookSendResult>;
	};
	skills: {
		list(cwd?: string): Promise<PluginOfficialSkillInfo[]>;
		getManifest(): Promise<Record<string, PluginOfficialInstalledSkill>>;
		setEnabled(name: string, enabled: boolean): Promise<{ name: string; enabled: boolean }>;
		uninstall(name: string, type?: "skill" | "scene"): Promise<void>;
		/**
		 * 从能力市场按 slug 安装 skill/scene（产品文案：能力）。
		 * 下载在主进程完成；密钥类凭证不经过此 API。
		 */
		installFromMarket(
			type: "skill" | "scene",
			slug: string,
		): Promise<{ name: string; type: "skill" | "scene"; version: string; updated: boolean }>;
	};
	shortcuts: {
		listAvailableActions(): Array<{ id: string; defaultShortcut: string }>;
		get(): Promise<{ bindings: PluginOfficialShortcutBinding[]; quickPanel: PluginOfficialQuickPanelSettings }>;
		setBinding(id: string, shortcut: string): Promise<{ bindings: PluginOfficialShortcutBinding[] }>;
		resetBinding(id: string): Promise<{ bindings: PluginOfficialShortcutBinding[]; shortcut: string }>;
		resetAllBindings(): Promise<{ bindings: PluginOfficialShortcutBinding[] }>;
		setQuickPanelTrigger(trigger: PluginOfficialQuickPanelSettings["trigger"]): Promise<PluginOfficialQuickPanelSettings>;
		setQuickPanelBehavior(
			behavior: PluginOfficialQuickPanelSettings["postSendBehavior"],
		): Promise<PluginOfficialQuickPanelSettings>;
	};
	im: {
		getStatus(): Promise<PluginOfficialImStatus>;
		getLogs(limit?: number): Promise<PluginOfficialImLog[]>;
		setEnabled(enabled: boolean): Promise<{ status: unknown }>;
		restart(): Promise<{ status: unknown }>;
		setAgentModel(
			modelKey: string | null,
			reasoningLevel?: string,
		): Promise<{ status: unknown }>;
		assertModelKeyExists(modelKey: string): Promise<void>;
		/**
		 * 写入飞书凭证。Agent 应省略 appSecret 等密钥，由审批弹窗让用户手填。
		 * 空字符串密钥字段表示保持现有值不改。
		 */
		setFeishuConfig(input: {
			enabled?: boolean;
			appId?: string;
			appSecret?: string;
			verificationToken?: string;
			encryptKey?: string;
			baseUrl?: string;
		}): Promise<{ ok: boolean; error?: string }>;
	};
	mcp: {
		list(): Promise<PluginOfficialMcpServerSummary[]>;
		get(name: string): Promise<PluginOfficialMcpServerDetail>;
		listNames(): Promise<string[]>;
		upsert(name: string, data: PluginOfficialMcpUpsertData): Promise<PluginOfficialMcpServerDetail>;
		setEnabled(name: string, enabled: boolean): Promise<void>;
		remove(name: string): Promise<void>;
	};
	models: {
		/**
		 * 用户当前可选的全部模型：本地配置的 provider **加上**登录后服务端下发的远程目录
		 * （Vetta Go 等，`remote: true`）。同一个 `provider/modelId` 以本地为准。
		 * 与宿主输入栏模型选择器同一口径。
		 */
		list(): Promise<{ defaultModel: string | null; providers: PluginOfficialProviderSummary[] }>;
		get(provider?: string): Promise<unknown>;
		probe(provider: string, model: string): Promise<{ ok: boolean; message?: string; error?: string }>;
		listProviderIds(): Promise<string[]>;
		assertModelKeyExists(modelKey: string, operation?: string): Promise<void>;
		setDefault(modelKey: string): Promise<{ defaultModel: string }>;
		upsertProvider(provider: string, data: PluginOfficialProviderUpsertData): Promise<PluginOfficialProviderDetail>;
		removeProvider(provider: string): Promise<void>;
	};
	projects: {
		list(): Promise<{
			workspacePath: string;
			projects: PluginOfficialProjectEntry[];
			archivedProjects: PluginOfficialProjectEntry[];
		}>;
		listSessions(cwd: string): Promise<unknown[]>;
		listRuntimeProjects(): Promise<unknown[]>;
		create(name: string, path?: string): Promise<PluginOfficialProjectEntry>;
		open(path: string, name?: string): Promise<PluginOfficialProjectEntry>;
		rename(path: string, name: string): Promise<PluginOfficialProjectEntry>;
		archive(path: string): Promise<void>;
		unarchive(path: string): Promise<void>;
		remove(path: string): Promise<void>;
	};
	plugins: {
		list(): Promise<PluginOfficialPluginSummary[]>;
		get(id: string): Promise<PluginOfficialPluginSummary>;
		setEnabled(id: string, enabled: boolean): Promise<PluginOfficialPluginSummary>;
		installFromUrl(url: string): Promise<PluginOfficialPluginSummary>;
		installFromPath(
			path: string,
			options?: { grantedPermissions?: string[]; enable?: boolean },
		): Promise<PluginOfficialPluginSummary>;
		uninstall(id: string): Promise<void>;
		reload(id: string): Promise<PluginOfficialPluginSummary>;
		grantPermissions(id: string, permissions: PluginPermission[]): Promise<PluginOfficialPluginSummary>;
		startDevWatch(id: string, projectDir: string): Promise<PluginOfficialPluginSummary>;
		stopDevWatch(id: string): Promise<void>;
		onChanged(handler: (event?: PluginOfficialPluginChangedEvent) => void): () => void;
	};
	dialog: {
		saveCopy(sourcePath: string, options?: PluginOfficialSaveCopyOptions): Promise<string | null>;
		/**
		 * 打开原生文件选择框，并把选中文件的**内容**一起返回。
		 *
		 * 插件的 `ctx.fs` 只能读已授权的项目根，因此「选个文件再自己去读」这条路走不通；
		 * 这个接口不放宽任何目录授权，插件能看到的只有用户这次亲手选中的文件。
		 * 用户取消时返回空数组。
		 */
		openFiles(options?: PluginOfficialOpenFilesOptions): Promise<PluginOfficialOpenedFile[]>;
	};
	shell: {
		/**
		 * 在系统文件管理器里定位并选中这个路径。
		 *
		 * 与 `ui.openExternal` 分工：那个只放行 http/https，用来把链接交给浏览器；
		 * 这个只做「显示这个本地路径」，不能用来拉起任意协议。
		 */
		showItemInFolder(path: string): Promise<void>;
	};
	knowledge: {
		list(): Promise<PluginOfficialKnowledgeBase[]>;
		fileStatuses(): Promise<Record<string, unknown>>;
		isProcessing(): Promise<boolean>;
		getProcessing(): Promise<PluginOfficialKnowledgeProcessingSettings>;
		create(name: string): Promise<void>;
		rename(name: string, newName: string): Promise<void>;
		delete(name: string): Promise<void>;
		addFiles(kbId: string, paths: string[], move?: boolean): Promise<void>;
		deleteEntry(kbId: string, relPath: string): Promise<void>;
		scanNow(): Promise<{ skipped: boolean; reason?: string }>;
		retryFailed(): Promise<{ skipped: boolean; reason?: string }>;
		setProcessing(
			data: Partial<{
				enabled: boolean;
				pollIntervalMinutes: 3 | 5 | 10 | 30;
				processingModelKey: string | null;
				processingModelReasoningLevel: string | null;
				agentConcurrency: number;
				ocrConcurrency: number;
			}>,
		): Promise<PluginOfficialKnowledgeProcessingSettings>;
	};
	batchTasks: {
		listProjects(): Promise<unknown[]>;
		getProject(projectId: string): Promise<unknown>;
		listProjectIds(): Promise<string[]>;
		createProject(data: PluginOfficialBatchProjectCreateData): Promise<unknown>;
		updateProject(projectId: string, data: PluginOfficialBatchProjectUpdateData): Promise<unknown>;
		deleteProject(projectId: string): Promise<unknown>;
		runTask(projectId: string, taskId: string): Promise<unknown>;
		retryTask(projectId: string, taskId: string): Promise<unknown>;
		stopTask(projectId: string, taskId: string): Promise<unknown>;
		deleteTask(projectId: string, taskId: string): Promise<unknown>;
		resumeTask(projectId: string, taskId: string): Promise<unknown>;
		resumeTaskWithText(projectId: string, taskId: string, text: string): Promise<unknown>;
		deleteTaskSession(projectId: string, taskId: string): Promise<unknown>;
		batchDelete(projectId: string): Promise<unknown>;
		batchStart(projectId: string): Promise<unknown>;
		batchStop(projectId: string): Promise<unknown>;
		batchReset(projectId: string): Promise<unknown>;
		batchResetFailed(projectId: string, taskIds: string[]): Promise<unknown>;
	};
	scheduler: {
		listTasks(): Promise<unknown[]>;
		getTask(taskId: string): Promise<unknown>;
		listTaskIds(): Promise<string[]>;
		getHistory(taskId: string): Promise<unknown[]>;
		createTask(data: PluginOfficialSchedulerTaskCreateData): Promise<unknown>;
		updateTask(taskId: string, data: PluginOfficialSchedulerTaskUpdateData): Promise<unknown>;
		deleteTask(taskId: string): Promise<unknown>;
		setEnabled(taskId: string, enabled: boolean): Promise<unknown>;
		runNow(taskId: string): Promise<unknown>;
		abort(taskId: string): Promise<unknown>;
	};
	appearance: {
		help(): Promise<unknown>;
		get(): Promise<unknown>;
		set(input: {
			mode?: "light" | "dark" | "auto";
			themeId?: string;
			cursorStyle?: "default" | "stoat";
		}): Promise<unknown>;
		setLanguage(language: "zh" | "en"): Promise<unknown>;
		listThemeIds(): string[];
	};
	/**
	 * 后台会话编排。会话本体跑在主进程，创建后即使宿主停留在别的页面也会继续执行，
	 * 因此系统插件可以据此做「多任务并发派单」类工作台（如看板）。
	 */
	sessions: {
		/**
		 * 在 `cwd` 下新建一个会话；不发送任何 prompt。
		 *
		 * 传 `modelKey`（`provider/modelId`）时写入该会话的模型设置，后续无论是插件
		 * 继续 `prompt`、还是用户在对话页手动接着聊，都用这个模型；不传则跟随宿主全局默认。
		 */
		create(input: { cwd: string; title?: string; modelKey?: string }): Promise<PluginOfficialSessionHandle>;
		/**
		 * 向会话发起一轮对话。streaming 中会进入该会话的输入队列（ADR-0060）。
		 *
		 * `options.modelKey` 只钉住**这一轮**用哪个模型（不改会话设置）；要让整个会话
		 * 都用某个模型，在 `create` 时传 `modelKey`。
		 */
		prompt(
			sessionId: string,
			text: string,
			options?: { modelKey?: string },
		): Promise<{ status: "sent" | "queued" }>;
		/** 中止会话当前回合。 */
		abort(sessionId: string): Promise<void>;
		/** 重命名会话（写入会话文件标题），用于把看板卡片标题同步到会话列表。 */
		rename(sessionPath: string, name: string): Promise<void>;
		/** 列出某目录下的历史会话。 */
		list(cwd: string): Promise<PluginOfficialSessionSummary[]>;
		/** 当前处于 agent loop 中的会话文件路径快照。 */
		listRunning(): Promise<string[]>;
		/**
		 * 当前有会话在跑的项目 cwd（去重）。
		 *
		 * 需要「这个项目忙不忙」时用它，不要拿 `listRunning()` 的路径去比对 cwd：会话文件
		 * 默认落在按 cwd 编码的分片目录里，那个编码不可逆且会让不同项目撞进同一分片。
		 */
		listRunningCwds(): Promise<string[]>;
		/** 订阅运行态翻转；返回取消订阅函数。 */
		onRunningChanged(handler: (event: PluginOfficialSessionRunningEvent) => void): () => void;
		/** 把宿主导航到该会话的对话页。 */
		open(input: { cwd: string; sessionPath: string }): Promise<void>;
	};
	navigation: {
		help(): unknown;
		resolveOpen(input: PluginOfficialNavigationOpenInput): {
			hashPath: string;
			resolved: unknown;
		};
		open(input: PluginOfficialNavigationOpenInput): Promise<unknown>;
	};
}
