import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Message, Model } from "@vetta/ai";
import { RuntimeAgentRuntime } from "../agents/index.js";
import type {
	HistoryEntry,
	ProjectInfo,
	PromptRequest,
	RuntimeSandboxGrantInfo,
	RuntimeTurnPromptOutcome,
	SessionConfig,
	SessionEvent,
	SessionExecutionMode,
	SessionFacade,
	SessionHistoryInfo,
	SessionStateSnapshot,
	SettingsPatch,
} from "../contracts.js";
import type { ConversationDocument } from "../conversation/document.js";
import { runtimeError } from "../errors.js";
import type { RuntimeToolDefinition, SessionContextRecord } from "../kernel/contracts.js";
import {
	createRuntimeObservationPublisher,
	type RuntimeObservationPublisher,
	runtimeObservationFailure,
} from "../observation/index.js";
import type { SessionExtensionEndpointToken } from "../session-extensions/contracts.js";
import { RuntimeHostAgentBackendRegistry } from "./agent-backend-admission.js";
import {
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	type RuntimeHostLifecycleObservation,
	type RuntimeHostLifecycleOperation,
} from "./observations.js";
import { RuntimeHostAgentInstaller } from "./runtime-host-agent-installer.js";
import { RuntimeHostCatalogFacade } from "./runtime-host-catalog-facade.js";
import { RuntimeHostCloseCoordinator } from "./runtime-host-close-coordinator.js";
import { RuntimeHostQueueSidecar } from "./runtime-host-queue-sidecar.js";
import { RuntimeHostSession } from "./runtime-host-session.js";
import { RuntimeHostSessionDirectory } from "./runtime-host-session-directory.js";
import { RuntimeHostSessionEventRelay } from "./runtime-host-session-event-relay.js";
import { RuntimeHostSessionLifecycle } from "./runtime-host-session-lifecycle.js";
import { RuntimeHostSessionOperations } from "./runtime-host-session-operations.js";
import { RuntimeHostSessionRequestFactory } from "./runtime-host-session-request-factory.js";
import type {
	RuntimeContextCompactionRequest,
	RuntimeContextCompactionResult,
	RuntimeContextCompactionState,
	RuntimeSessionContextDeliveryMode,
	RuntimeSessionContextUsage,
	RuntimeSessionExecutionObservation,
	RuntimeSessionQueueStateView,
	RuntimeSessionState,
} from "./session-ports.js";
import type {
	RuntimeHostPathServices,
	RuntimeSandboxGrantStore,
	RuntimeSessionAccess,
	RuntimeSharedModelController,
} from "./session-services.js";
import type {
	RunningChangedReason,
	RuntimeHostAgentInstallation,
	RuntimeHostAgentInstallationOptions,
	RuntimeHostOptions,
	RuntimeHostSessionRecord,
} from "./types.js";

export type { RunningChangedReason, RuntimeHostOptions } from "./types.js";

/**
 * Runtime Core 的公共组合根与兼容 Facade。
 *
 * 该类只装配职责组件并转发公共合同；Session 生命周期、索引、事件、在线操作、
 * 离线 Catalog、交互、Agent 安装和关闭各自只有一个内部 owner。
 */
export class RuntimeHost implements SessionFacade {
	readonly agents: RuntimeAgentRuntime;
	readonly agentBackends: RuntimeHostAgentBackendRegistry;
	private readonly agentInstaller: RuntimeHostAgentInstaller;
	private readonly sessionDirectory: RuntimeHostSessionDirectory;
	private readonly sessionEvents: RuntimeHostSessionEventRelay;
	private readonly sessionOperations: RuntimeHostSessionOperations;
	private readonly sessionLifecycle: RuntimeHostSessionLifecycle;
	private readonly catalogFacade: RuntimeHostCatalogFacade;
	private readonly sessionRequestFactory: RuntimeHostSessionRequestFactory;
	private readonly observations: RuntimeObservationPublisher;
	private closed = false;
	private readonly closeCoordinator: RuntimeHostCloseCoordinator;
	private readonly sharedModelController: RuntimeSharedModelController | undefined;
	private readonly pathServices: RuntimeHostPathServices | undefined;
	private readonly queueSidecar: RuntimeHostQueueSidecar;
	private readonly sandboxGrantStore: RuntimeSandboxGrantStore | undefined;

	constructor(options: RuntimeHostOptions = {}) {
		if (options.sessionBackend && options.createSessionBackend) {
			throw new Error("RuntimeHost accepts either sessionBackend or createSessionBackend, not both");
		}
		if (options.observationPort && options.observationPublisher) {
			throw new Error("RuntimeHost accepts either observationPort or observationPublisher, not both");
		}
		this.observations =
			options.observationPublisher ?? createRuntimeObservationPublisher({ port: options.observationPort });
		const ownsObservationPublisher = options.observationPublisher === undefined;
		const ownedObservationPort = options.observationPublisher === undefined ? options.observationPort : undefined;
		this.agents = new RuntimeAgentRuntime({
			...options.agentRuntimeOptions,
			observationPublisher: this.observations,
		});
		this.sharedModelController = options.sharedModelController;
		this.pathServices = options.pathServices;
		this.sessionDirectory = new RuntimeHostSessionDirectory((path) => this.normalizePath(path));
		this.queueSidecar = new RuntimeHostQueueSidecar({
			store: options.queueSidecarStore,
			normalizePath: (path) => this.normalizePath(path),
			reportFailure: (error, sessionId) =>
				this.recordLifecycleFailure("session.persist", "queue-sidecar", error, sessionId),
		});
		this.sessionEvents = new RuntimeHostSessionEventRelay({
			queueSidecar: this.queueSidecar,
			synchronizeSessionIdentity: (sessionKey, handle) => this.synchronizeSessionIdentity(sessionKey, handle),
			sessionErrorObserver: options.sessionErrorObserver,
			sessionCompactionObserver: options.sessionCompactionObserver,
			reportFailure: (operation, component, error, sessionId) =>
				this.recordLifecycleFailure(operation, component, error, sessionId),
		});
		this.sessionOperations = new RuntimeHostSessionOperations({
			directory: this.sessionDirectory,
			events: this.sessionEvents,
			pathServices: this.pathServices,
			sandboxHostPath: options.sandboxHostPath,
			linuxBubblewrapPath: options.linuxBubblewrapPath,
			macosSandboxExecPath: options.macosSandboxExecPath,
			synchronizeSessionIdentity: (sessionKey, handle) => this.synchronizeSessionIdentity(sessionKey, handle),
			reportWorkspacePreparationFailure: (error, sessionId) =>
				this.recordLifecycleFailure("session.prepare", "session-workspace", error, sessionId),
		});
		this.sandboxGrantStore = options.sandboxGrantStore;
		this.sessionRequestFactory = new RuntimeHostSessionRequestFactory({
			serverUrl: options.serverUrl,
			sandboxHostPath: options.sandboxHostPath,
			linuxBubblewrapPath: options.linuxBubblewrapPath,
			macosSandboxExecPath: options.macosSandboxExecPath,
		});
		const sessionBackend =
			options.sessionBackend ??
			options.createSessionBackend?.({ agents: this.agents, observationPublisher: this.observations });
		const ownsSessionBackend = options.createSessionBackend !== undefined;
		this.agentBackends = new RuntimeHostAgentBackendRegistry({
			defaultBackend: sessionBackend,
			observationPublisher: this.observations,
		});
		this.agentInstaller = new RuntimeHostAgentInstaller({
			agents: this.agents,
			agentBackends: this.agentBackends,
			observations: this.observations,
			assertHostOpen: () => this.assertOpen(),
		});
		this.sessionLifecycle = new RuntimeHostSessionLifecycle({
			directory: this.sessionDirectory,
			events: this.sessionEvents,
			queueSidecar: this.queueSidecar,
			backend: this.agentBackends,
			operations: this.sessionOperations,
			getDefaultExecutionMode: options.getDefaultExecutionMode ?? (() => "sandbox"),
			createRequest: (config, executionMode, sessionIdRef) =>
				this.sessionRequestFactory.create(config, executionMode, sessionIdRef),
			assertHostOpen: () => this.assertOpen(),
			sharedModelController: this.sharedModelController,
			sandboxGrantStore: this.sandboxGrantStore,
			reportDisposeFailure: (error, sessionId) =>
				this.recordLifecycleFailure("session.dispose", "sessions", error, sessionId),
		});
		this.catalogFacade = new RuntimeHostCatalogFacade({
			catalog: options.sessionCatalog,
			fileHistoryReader: options.sessionFileHistoryReader,
			accessResolver: options.sessionAccessResolver,
			normalizePath: (path) => this.normalizePath(path),
			sessionLifecycle: this.sessionLifecycle,
			sessionOperations: this.sessionOperations,
		});
		this.closeCoordinator = new RuntimeHostCloseCoordinator({
			observations: this.observations,
			ownsObservationPublisher,
			ownedObservationPort,
			tasks: [
				{
					component: "session-creations",
					dispose: () => this.sessionLifecycle.waitForPendingCreations(),
				},
				{ component: "sessions", dispose: () => this.sessionLifecycle.disposeAllSessions() },
				{ component: "agent-backends", dispose: () => this.agentBackends.close() },
				{
					component: "session-backend",
					dispose: () =>
						ownsSessionBackend ? (sessionBackend?.dispose?.() ?? Promise.resolve()) : Promise.resolve(),
				},
				{ component: "agent-runtime", dispose: () => this.agents.close() },
			],
		});
	}

	/**
	 * 原子安装一个新的平级主 Agent Definition 与 Host Backend。
	 * Backend 可异步准备，但在准备完成前不会发布 Definition，避免半安装状态进入发现面。
	 */
	async installAgent(options: RuntimeHostAgentInstallationOptions): Promise<RuntimeHostAgentInstallation> {
		return this.agentInstaller.install(options);
	}

	listSandboxGrants(sessionId: string): RuntimeSandboxGrantInfo[] {
		return [...(this.sandboxGrantStore?.list(this.sessionDirectory.readCanonicalSessionId(sessionId)) ?? [])];
	}

	revokeSandboxGrant(sessionId: string, grantId: string): boolean {
		return this.sandboxGrantStore?.revoke(this.sessionDirectory.readCanonicalSessionId(sessionId), grantId) ?? false;
	}

	revokeAllSandboxGrants(sessionId: string): number {
		return this.sandboxGrantStore?.revokeAll(this.sessionDirectory.readCanonicalSessionId(sessionId)) ?? 0;
	}

	/**
	 * Push a new server token to the ModelRegistry and refresh remote models.
	 * Call this after login / logout so long-lived sessions pick up auth changes
	 * without an app restart.
	 *
	 * 共享 modelRegistry 模式（desktop-app）：单点更新，所有 session 立即看到。
	 * 兼容旧模式（无共享 registry）：遍历每个 session 的 registry。
	 */
	async reloadServerAuth(token: string | undefined): Promise<void> {
		if (this.sharedModelController) {
			try {
				await this.sharedModelController.refreshAuth(token);
			} catch (error) {
				this.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
					operation: "auth.refresh",
					phase: "failed",
					component: "shared-model",
					failure: runtimeObservationFailure(error),
				});
			}
			return;
		}
		const handles = Array.from(this.sessionDirectory.values());
		await Promise.all(
			handles.map(async ({ lifecycle, modelController }) => {
				try {
					await modelController.refreshAuth(token);
				} catch (error) {
					this.observations.record(
						RUNTIME_HOST_LIFECYCLE_OBSERVATION,
						{
							operation: "auth.refresh",
							phase: "failed",
							component: "session-model",
							failure: runtimeObservationFailure(error),
						},
						{ sessionId: lifecycle.sessionId },
					);
				}
			}),
		);
	}

	/**
	 * 创建或复用 Session。生命周期组件按规范化文件路径去重，避免同一进程重复获取文件锁。
	 */
	async createSession(config: SessionConfig = {}): Promise<{ sessionId: string }> {
		return this.sessionLifecycle.createSession(config);
	}

	async setExecutionMode(sessionId: string, mode: SessionExecutionMode): Promise<void> {
		await this.sessionOperations.setExecutionMode(sessionId, mode);
	}

	async setGlobalExecutionMode(mode: SessionExecutionMode): Promise<void> {
		await this.sessionOperations.setGlobalExecutionMode(mode);
	}

	async prompt(sessionId: string, request: PromptRequest): Promise<RuntimeTurnPromptOutcome> {
		return this.sessionOperations.prompt(sessionId, request);
	}

	async continue(sessionId: string): Promise<void> {
		await this.sessionOperations.continue(sessionId);
	}

	async retry(sessionId: string): Promise<void> {
		await this.sessionOperations.retry(sessionId);
	}

	async abort(sessionId: string): Promise<void> {
		await this.sessionOperations.abort(sessionId);
	}

	// ---- 输入队列管理（ADR-0060）。backend 不具备 queueController 时静默降级为空队列。 ----

	getQueueState(sessionId: string): RuntimeSessionQueueStateView {
		return this.sessionOperations.getQueueState(sessionId);
	}

	removeQueuedMessage(sessionId: string, itemId: string): boolean {
		return this.sessionOperations.removeQueuedMessage(sessionId, itemId);
	}

	reorderQueuedMessages(sessionId: string, itemIds: readonly string[]): void {
		this.sessionOperations.reorderQueuedMessages(sessionId, itemIds);
	}

	async sendQueuedMessageNow(sessionId: string, itemId: string): Promise<"promoted" | "started" | "missing"> {
		return this.sessionOperations.sendQueuedMessageNow(sessionId, itemId);
	}

	async resumeQueue(sessionId: string): Promise<void> {
		await this.sessionOperations.resumeQueue(sessionId);
	}

	clearQueue(sessionId: string): void {
		this.sessionOperations.clearQueue(sessionId);
	}

	/** 通过类型化 token 调用当前会话公开的产品扩展端点。 */
	async invokeSessionExtension<Input, Output>(
		sessionId: string,
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal?: AbortSignal,
	): Promise<Output> {
		return this.sessionOperations.invokeSessionExtension(sessionId, token, input, signal);
	}

	hasSessionExtension<Input, Output>(sessionId: string, token: SessionExtensionEndpointToken<Input, Output>): boolean {
		return this.sessionOperations.hasSessionExtension(sessionId, token);
	}

	invokeSessionExtensionSync<Input, Output>(
		sessionId: string,
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
	): Output {
		return this.sessionOperations.invokeSessionExtensionSync(sessionId, token, input);
	}

	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
		return this.sessionOperations.subscribe(sessionId, handler);
	}

	subscribeExecutionObservations(
		sessionId: string,
		handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		return this.sessionOperations.subscribeExecutionObservations(sessionId, handler);
	}

	private recordLifecycleFailure(
		operation: RuntimeHostLifecycleOperation,
		component: NonNullable<RuntimeHostLifecycleObservation["component"]>,
		error: unknown,
		sessionId?: string,
	): void {
		this.observations.record(
			RUNTIME_HOST_LIFECYCLE_OBSERVATION,
			{
				operation,
				phase: "failed",
				component,
				failure: runtimeObservationFailure(error),
			},
			sessionId ? { sessionId } : undefined,
		);
	}

	readSessionContextCompactionState(sessionId: string): RuntimeContextCompactionState {
		return this.sessionOperations.readSessionContextCompactionState(sessionId);
	}

	async compactSessionContext(
		sessionId: string,
		request?: RuntimeContextCompactionRequest,
	): Promise<RuntimeContextCompactionResult> {
		return this.sessionOperations.compactSessionContext(sessionId, request);
	}

	abortSessionContextCompaction(sessionId: string): void {
		this.sessionOperations.abortSessionContextCompaction(sessionId);
	}

	async updateSettings(sessionId: string, partialSettings: SettingsPatch): Promise<void> {
		await this.sessionOperations.updateSettings(sessionId, partialSettings);
	}

	setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
		this.sessionOperations.setSessionThinkingLevel(sessionId, level);
	}

	setSessionSteeringMode(sessionId: string, mode: NonNullable<SettingsPatch["steeringMode"]>): void {
		this.sessionOperations.setSessionSteeringMode(sessionId, mode);
	}

	setSessionFollowUpMode(sessionId: string, mode: NonNullable<SettingsPatch["followUpMode"]>): void {
		this.sessionOperations.setSessionFollowUpMode(sessionId, mode);
	}

	updateGlobalThinkingLevel(level: ThinkingLevel): void {
		this.sessionOperations.updateGlobalThinkingLevel(level);
	}

	getState(sessionId: string): SessionStateSnapshot {
		return this.sessionOperations.getState(sessionId);
	}

	readRuntimeSessionState(sessionId: string): RuntimeSessionState {
		return this.sessionOperations.readRuntimeSessionState(sessionId);
	}

	readSessionDocument(sessionId: string): ConversationDocument {
		return this.sessionOperations.readSessionDocument(sessionId);
	}

	readSessionWorkingDirectory(sessionId: string): string | undefined {
		return this.sessionOperations.readSessionWorkingDirectory(sessionId);
	}

	getSessionDirectory(sessionId: string): string | undefined {
		return this.sessionOperations.getSessionDirectory(sessionId);
	}

	readSessionContextUsage(sessionId: string): RuntimeSessionContextUsage | undefined {
		return this.sessionOperations.readSessionContextUsage(sessionId);
	}

	readSessionCompactionState(sessionId: string): RuntimeContextCompactionState {
		return this.sessionOperations.readSessionCompactionState(sessionId);
	}

	setSessionAutoCompactionEnabled(sessionId: string, enabled: boolean): void {
		this.sessionOperations.setSessionAutoCompactionEnabled(sessionId, enabled);
	}

	deliverSessionContext(
		sessionId: string,
		records: readonly SessionContextRecord[],
		mode: RuntimeSessionContextDeliveryMode,
	): Promise<void> {
		return this.sessionOperations.deliverSessionContext(sessionId, records, mode);
	}

	readSessionName(sessionId: string): string | undefined {
		return this.sessionOperations.readSessionName(sessionId);
	}

	readSessionActiveToolNames(sessionId: string): readonly string[] {
		return this.sessionOperations.readSessionActiveToolNames(sessionId);
	}

	readSessionAvailableTools(sessionId: string): ReadonlyMap<string, RuntimeToolDefinition> {
		return this.sessionOperations.readSessionAvailableTools(sessionId);
	}

	setSessionActiveToolNames(sessionId: string, toolNames: readonly string[]): void {
		this.sessionOperations.setSessionActiveToolNames(sessionId, toolNames);
	}

	selectSessionModel(
		sessionId: string,
		modelKey: string,
		strategy: "if-changed" | "always" = "always",
	): Promise<void> {
		return this.sessionOperations.selectSessionModel(sessionId, modelKey, strategy);
	}

	resolveSessionModelApiKey(sessionId: string, model: Model<Api>): Promise<string | undefined> {
		return this.sessionOperations.resolveSessionModelApiKey(sessionId, model);
	}

	readSessionCurrentModel(sessionId: string): Model<Api> | undefined {
		return this.sessionOperations.readSessionCurrentModel(sessionId);
	}

	readSessionAvailableModels(sessionId: string): readonly Model<Api>[] {
		return this.sessionOperations.readSessionAvailableModels(sessionId);
	}

	readSessionQueueModes(sessionId: string): {
		readonly steering: NonNullable<SettingsPatch["steeringMode"]>;
		readonly followUp: NonNullable<SettingsPatch["followUpMode"]>;
	} {
		return this.sessionOperations.readSessionQueueModes(sessionId);
	}

	readSessionQueuedMessages(sessionId: string): {
		readonly steering: readonly string[];
		readonly followUp: readonly string[];
	} {
		return this.sessionOperations.readSessionQueuedMessages(sessionId);
	}

	clearSessionQueue(sessionId: string): {
		readonly steering: readonly string[];
		readonly followUp: readonly string[];
	} {
		return this.sessionOperations.clearSessionQueue(sessionId);
	}

	async appendSessionBranchSummary(
		sessionId: string,
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): Promise<{ entryId: string }> {
		return this.sessionOperations.appendSessionBranchSummary(sessionId, parentId, summary, details, fromHook);
	}

	appendSessionMetadataEntry(sessionId: string, customType: string, data?: unknown): Promise<void> {
		return this.sessionOperations.appendSessionMetadataEntry(sessionId, customType, data);
	}

	setSessionLabel(sessionId: string, entryId: string, label: string | undefined): Promise<void> {
		return this.sessionOperations.setSessionLabel(sessionId, entryId, label);
	}

	getSessionView(sessionId: string): RuntimeHostSession {
		this.sessionDirectory.get(sessionId);
		return new RuntimeHostSession(this, sessionId);
	}

	getMessages(sessionId: string): Message[] {
		return this.sessionOperations.getMessages(sessionId);
	}

	getFullHistory(sessionId: string): HistoryEntry[] {
		return this.sessionOperations.getFullHistory(sessionId);
	}

	/**
	 * Read a session .jsonl directly from disk and translate to HistoryEntry[].
	 * Does NOT acquire the session-file lock — used by the desktop sidebar's
	 * read-only viewer for sessions whose sidecar may be actively
	 * writing to the same file.
	 */
	readSessionHistoryFromFile(path: string): { history: HistoryEntry[] } {
		return this.catalogFacade.readSessionHistoryFromFile(path);
	}

	/** Resolve host capabilities for an existing session without opening or locking it. */
	resolveSessionAccess(sessionPath: string): Promise<RuntimeSessionAccess | undefined> {
		return this.catalogFacade.resolveSessionAccess(sessionPath);
	}

	/**
	 * Prepare re-edit of a user message (leaf → parent). Returns extracted text.
	 * Does not send a prompt; the host should prompt after the user edits.
	 * Throws if entryId is missing from this session (stale pending edit after fork/switch).
	 */
	async navigateForEdit(sessionId: string, entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return this.sessionOperations.navigateForEdit(sessionId, entryId);
	}

	/** Switch leaf to the tip of another branch (same session file). */
	async switchBranch(sessionId: string, entryId: string): Promise<{ leafId: string }> {
		return this.sessionOperations.switchBranch(sessionId, entryId);
	}

	/** Delete one message while retaining the rest of the active branch. */
	async deleteMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }> {
		return this.sessionOperations.deleteMessage(sessionId, entryId);
	}

	/** Remove the active branch's last user turn so the next prompt replaces it in place. */
	async replaceLastUserMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }> {
		return this.sessionOperations.replaceLastUserMessage(sessionId, entryId);
	}

	/**
	 * Export a fork as a new session file without leaving the current session.
	 */
	async forkSession(sessionId: string, entryId: string): Promise<{ path: string; text: string }> {
		return this.sessionOperations.forkSession(sessionId, entryId);
	}

	async listProjects(): Promise<ProjectInfo[]> {
		return this.catalogFacade.listProjects();
	}

	async listSessions(cwd: string, sessionDir?: string): Promise<SessionHistoryInfo[]> {
		return this.catalogFacade.listSessions(cwd, sessionDir);
	}

	async deleteSession(sessionPath: string): Promise<void> {
		await this.catalogFacade.deleteSession(sessionPath);
	}

	async renameSession(sessionPath: string, name: string): Promise<void> {
		await this.catalogFacade.renameSession(sessionPath, name);
	}

	/** Snapshot of session paths whose agent loop is currently active. */
	getRunningSessionPaths(): string[] {
		return this.sessionEvents.getRunningSessionPaths();
	}

	/**
	 * Subscribe to running-set changes. Handler receives (sessionPath, running).
	 * Returns an unsubscribe function.
	 */
	onRunningChanged(
		handler: (sessionPath: string, running: boolean, sessionId?: string, reason?: RunningChangedReason) => void,
	): () => void {
		return this.sessionEvents.onRunningChanged(handler);
	}

	getSessionPath(sessionId: string): string | undefined {
		return this.sessionOperations.getSessionPath(sessionId);
	}

	async renameSessionById(sessionId: string, name: string): Promise<void> {
		// We already hold the live AgentSession — rename through it directly so
		// we never open a second SessionManager (and second lock) on the file.
		await this.sessionOperations.renameSessionById(sessionId, name);
	}

	async disposeSession(sessionId: string): Promise<void> {
		await this.sessionLifecycle.disposeSession(sessionId);
	}

	/**
	 * Dispose every open session this host owns and release all file locks.
	 * Call from the IPC layer when its host (e.g. an Electron WebContents) is
	 * being torn down — otherwise SessionManager locks survive until process exit.
	 */
	async disposeAllSessions(): Promise<void> {
		await this.sessionLifecycle.disposeAllSessions();
	}

	/** 关闭唯一 Host 拥有的 Session、Backend、Agent 控制面和根观测发布器。 */
	close(): Promise<void> {
		this.closed = true;
		return this.closeCoordinator.close();
	}

	private assertOpen(): void {
		if (this.closed) throw runtimeError("INTERNAL_ERROR", "RuntimeHost is closed", false, "runtime");
	}

	/** Returns the current persisted identity while retaining retired identities as live aliases. */
	readCanonicalSessionId(sessionId: string): string {
		return this.sessionDirectory.readCanonicalSessionId(sessionId);
	}

	private synchronizeSessionIdentity(sessionKey: string, handle: RuntimeHostSessionRecord): void {
		const rebind = this.sessionDirectory.synchronizeIdentity(sessionKey, handle);
		if (!rebind) return;
		// Continuation starts a new persisted conversation. Grants never cross that boundary implicitly.
		this.sandboxGrantStore?.clear(rebind.previousSessionId);
		this.observations.record(
			RUNTIME_HOST_LIFECYCLE_OBSERVATION,
			{ operation: "session.rebind", phase: "completed", component: "sessions" },
			{ sessionId: rebind.nextSessionId },
		);
	}

	private normalizePath(path: string): string {
		return this.pathServices?.normalize(path) ?? path;
	}
}
