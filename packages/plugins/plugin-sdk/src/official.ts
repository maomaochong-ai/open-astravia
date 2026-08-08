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
	navigation: {
		help(): unknown;
		resolveOpen(input: { target: string; tab?: string; section?: string }): {
			hashPath: string;
			resolved: unknown;
		};
		open(input: { target: string; tab?: string; section?: string }): Promise<unknown>;
	};
}
