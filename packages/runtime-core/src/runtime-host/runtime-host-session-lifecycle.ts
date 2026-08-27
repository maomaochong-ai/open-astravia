import type { SessionConfig, SessionExecutionMode } from "../contracts.js";
import type { RuntimeHostAgentBackendRegistry } from "./agent-backend-admission.js";
import type { RuntimeHostQueueSidecar } from "./runtime-host-queue-sidecar.js";
import type { RuntimeHostSessionDirectory } from "./runtime-host-session-directory.js";
import type { RuntimeHostSessionEventRelay } from "./runtime-host-session-event-relay.js";
import type { RuntimeHostSessionOperations } from "./runtime-host-session-operations.js";
import type { RuntimeSessionCreateRequest } from "./session-backend.js";
import type { RuntimeSessionHostInteractionContext } from "./session-ports.js";
import type { RuntimeSandboxGrantStore, RuntimeSharedModelController } from "./session-services.js";
import type { RuntimeHostSessionRecord } from "./types.js";

const DEFAULT_RUNTIME_SCENARIO: NonNullable<SessionConfig["scenario"]> = "cli";

export interface RuntimeHostSessionLifecycleOptions {
	readonly directory: RuntimeHostSessionDirectory;
	readonly events: RuntimeHostSessionEventRelay;
	readonly queueSidecar: RuntimeHostQueueSidecar;
	readonly backend: RuntimeHostAgentBackendRegistry;
	readonly operations: RuntimeHostSessionOperations;
	readonly getDefaultExecutionMode: () => SessionExecutionMode | Promise<SessionExecutionMode>;
	readonly createRequest: (
		config: SessionConfig,
		executionMode: SessionExecutionMode,
		sessionIdRef: { current?: string },
	) => RuntimeSessionCreateRequest;
	readonly createHostInteractionContext: (sessionIdRef: { current?: string }) => RuntimeSessionHostInteractionContext;
	readonly assertHostOpen: () => void;
	readonly sharedModelController?: RuntimeSharedModelController;
	readonly sandboxGrantStore?: RuntimeSandboxGrantStore;
	readonly reportDisposeFailure: (error: unknown, sessionId: string) => void;
}

/**
 * RuntimeHost Session 创建、激活、回滚与释放的唯一生命周期协调器。
 *
 * Directory 只负责索引，Event Relay 只负责投影；本对象负责决定何时注册和何时
 * 删除所有权，从而让初始化失败、重复释放和 Host close 等路径共享同一事务语义。
 */
export class RuntimeHostSessionLifecycle {
	private readonly disposeAttempts = new Map<string, Promise<void>>();
	private pendingCreationCount = 0;
	private readonly pendingCreationWaiters = new Set<() => void>();

	constructor(private readonly options: RuntimeHostSessionLifecycleOptions) {}

	async createSession(config: SessionConfig = {}): Promise<{ sessionId: string }> {
		const releaseAdmission = this.beginCreation();
		try {
			return await this.createSessionInternal(config);
		} finally {
			releaseAdmission();
		}
	}

	findBySessionPath(sessionPath: string): { sessionId: string; handle: RuntimeHostSessionRecord } | undefined {
		const result = this.options.directory.findBySessionPath(sessionPath);
		return result ? { sessionId: result.sessionId, handle: result.handle } : undefined;
	}

	async disposeSession(sessionId: string): Promise<void> {
		let sessionKey: string;
		try {
			sessionKey = this.options.directory.resolveSessionKey(sessionId);
		} catch {
			return;
		}
		const handle = this.options.directory.getByKey(sessionKey);
		if (!handle) return;
		const existingAttempt = this.disposeAttempts.get(sessionKey);
		if (existingAttempt) return existingAttempt;
		const operation = this.disposeSessionHandle(sessionKey, handle);
		const tracked = operation.finally(() => {
			if (this.disposeAttempts.get(sessionKey) === tracked) this.disposeAttempts.delete(sessionKey);
		});
		this.disposeAttempts.set(sessionKey, tracked);
		return tracked;
	}

	async disposeAllSessions(): Promise<void> {
		const results = await Promise.allSettled(
			[...this.options.directory.keys()].map((sessionKey) => this.disposeSession(sessionKey)),
		);
		const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "Failed to dispose all RuntimeHost Sessions");
	}

	waitForPendingCreations(): Promise<void> {
		if (this.pendingCreationCount === 0) return Promise.resolve();
		return new Promise((resolve) => this.pendingCreationWaiters.add(resolve));
	}

	private async createSessionInternal(config: SessionConfig): Promise<{ sessionId: string }> {
		const sessionPath = config.sessionPath?.trim() || undefined;
		if (sessionPath) {
			const existing = this.findBySessionPath(sessionPath);
			if (existing) {
				if (config.executionMode !== undefined && config.executionMode !== existing.handle.executionMode) {
					await this.options.operations.setExecutionMode(existing.sessionId, config.executionMode);
				}
				await existing.handle.hostInteraction.bind(
					this.options.createHostInteractionContext({ current: existing.sessionId }),
				);
				return { sessionId: existing.sessionId };
			}
		}

		const executionMode = config.executionMode ?? (await this.options.getDefaultExecutionMode());
		const sessionIdRef: { current?: string } = {};
		const request = this.options.createRequest(config, executionMode, sessionIdRef);
		const assembly = await this.options.backend.createAssembly(request);
		const handle: RuntimeHostSessionRecord = {
			lifecycle: assembly.lifecycle,
			historyReader: assembly.historyReader,
			historyController: assembly.historyController,
			hostInteraction: assembly.hostInteraction,
			executionController: assembly.executionController,
			workspaceView: assembly.workspaceView,
			extensionHost: assembly.extensionHost,
			configurationController: assembly.configurationController,
			modelController: assembly.modelController,
			modelView: assembly.modelView,
			contextController: assembly.contextController,
			contextDeliveryController: assembly.contextDeliveryController,
			contextUsageView: assembly.contextUsageView,
			conversationView: assembly.conversationView,
			executionObservationStream: assembly.executionObservationStream,
			toolController: assembly.toolController,
			...assembly.corePorts,
			queueController: assembly.queueController,
			metadataController: assembly.metadataController,
			executionMode,
			pendingConfiguration: { executionMode: undefined, hasExecutionMode: false },
			scenario: config.scenario ?? DEFAULT_RUNTIME_SCENARIO,
			agentMode: config.agentMode,
		};
		const sessionId = handle.lifecycle.sessionId;
		sessionIdRef.current = sessionId;
		if (this.options.directory.hasIdentity(sessionId)) {
			const error = new Error(`RuntimeHost Session id is already registered: ${sessionId}`);
			try {
				await handle.lifecycle.dispose();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Duplicate RuntimeHost Session initialization and rollback failed",
					{ cause: error },
				);
			}
			throw error;
		}

		this.options.directory.register(sessionId, handle);
		try {
			await handle.hostInteraction.bind(this.options.createHostInteractionContext(sessionIdRef));
			this.options.events.attach(sessionId, handle, handle.eventStream);
			if (handle.queueController && sessionPath) {
				await this.options.queueSidecar.restore(handle.queueController, handle.lifecycle.sessionPath);
			}
			if (sessionPath && !config.model) {
				await this.restoreModelFromHistory(handle);
			}
			this.options.sharedModelController?.refreshInBackground();
			return { sessionId };
		} catch (error) {
			try {
				await this.disposeSession(sessionId);
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "RuntimeHost Session initialization and rollback failed", {
					cause: error,
				});
			}
			throw error;
		}
	}

	private async restoreModelFromHistory(handle: RuntimeHostSessionRecord): Promise<void> {
		try {
			const history = handle.historyReader.readHistory();
			for (let index = history.length - 1; index >= 0; index -= 1) {
				const entry = history[index];
				if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
				const { provider, model } = entry.message;
				if (!provider || !model) return;
				await handle.modelController.selectModel(`${provider}/${model}`, "if-changed");
				return;
			}
		} catch {
			// Model restore is best-effort and never invalidates an acquired Session.
		}
	}

	private async disposeSessionHandle(sessionKey: string, handle: RuntimeHostSessionRecord): Promise<void> {
		try {
			await handle.lifecycle.dispose();
			if (!this.options.directory.isRegisteredOwner(sessionKey, handle)) return;
			const canonicalSessionId = this.options.directory.readCanonicalSessionIdByKey(
				sessionKey,
				handle.lifecycle.sessionId,
			);
			this.options.sandboxGrantStore?.clear(canonicalSessionId);
			this.options.events.release(sessionKey, handle.lifecycle.sessionPath, canonicalSessionId);
			this.options.directory.remove(sessionKey, handle);
		} catch (error) {
			this.options.reportDisposeFailure(error, handle.lifecycle.sessionId);
			throw error;
		}
	}

	private beginCreation(): () => void {
		this.options.assertHostOpen();
		this.pendingCreationCount += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.pendingCreationCount -= 1;
			if (this.pendingCreationCount !== 0) return;
			for (const resolve of this.pendingCreationWaiters) resolve();
			this.pendingCreationWaiters.clear();
		};
	}
}
