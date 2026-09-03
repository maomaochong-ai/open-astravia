import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Message, Model } from "@vetta/ai";
import type {
	HistoryEntry,
	PromptRequest,
	RuntimeTurnPromptOutcome,
	SessionEvent,
	SessionExecutionMode,
	SessionStateSnapshot,
	SettingsPatch,
} from "../contracts.js";
import type { ConversationDocument } from "../conversation/document.js";
import type { ConversationMessageRecord } from "../conversation/message-contract.js";
import { isSessionError, runtimeError } from "../errors.js";
import type { RuntimeToolDefinition, SessionContextRecord } from "../kernel/contracts.js";
import { isTurnPersistenceError } from "../kernel/errors.js";
import type { SessionExtensionEndpointToken } from "../session-extensions/contracts.js";
import type { RuntimeHostSessionDirectory } from "./runtime-host-session-directory.js";
import type { RuntimeHostSessionEventRelay } from "./runtime-host-session-event-relay.js";
import { baseSessionEvent } from "./session-events.js";
import type {
	RuntimeContextCompactionRequest,
	RuntimeContextCompactionResult,
	RuntimeContextCompactionState,
	RuntimeContextSummaryRequest,
	RuntimeContextSummaryResult,
	RuntimeSessionContextDeliveryMode,
	RuntimeSessionContextUsage,
	RuntimeSessionExecutionObservation,
	RuntimeSessionQueueController,
	RuntimeSessionQueueStateView,
	RuntimeSessionState,
} from "./session-ports.js";
import type { RuntimeHostPathServices } from "./session-services.js";
import type { RuntimeHostSessionRecord } from "./types.js";

export interface RuntimeHostSessionOperationsOptions {
	readonly directory: RuntimeHostSessionDirectory;
	readonly events: RuntimeHostSessionEventRelay;
	readonly pathServices?: RuntimeHostPathServices;
	readonly sandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly synchronizeSessionIdentity: (sessionKey: string, handle: RuntimeHostSessionRecord) => void;
	readonly reportWorkspacePreparationFailure: (error: unknown, sessionId: string) => void;
}

/**
 * 对活动 RuntimeHost Session typed ports 的统一操作面。
 *
 * 它不创建、索引或释放 Session；所有查找通过 Directory，事件投影通过 Event Relay。
 * RuntimeHost 与 scoped RuntimeHostSession 都复用该实现，避免 Host 本身持有产品操作状态。
 */
export class RuntimeHostSessionOperations {
	constructor(private readonly options: RuntimeHostSessionOperationsOptions) {}

	async setExecutionMode(sessionId: string, mode: SessionExecutionMode): Promise<void> {
		const handle = this.requireSession(sessionId);
		if (handle.executionMode === mode) {
			handle.pendingConfiguration.executionMode = undefined;
			handle.pendingConfiguration.hasExecutionMode = false;
			return;
		}
		if (handle.executionController.isBusy()) {
			handle.pendingConfiguration.executionMode = mode;
			handle.pendingConfiguration.hasExecutionMode = true;
			return;
		}
		await this.applyExecutionMode(sessionId, handle, mode);
	}

	async setGlobalExecutionMode(mode: SessionExecutionMode): Promise<void> {
		for (const sessionKey of this.options.directory.keys()) {
			await this.setExecutionMode(sessionKey, mode);
		}
	}

	async prompt(sessionId: string, request: PromptRequest): Promise<RuntimeTurnPromptOutcome> {
		const sessionKey = this.options.directory.resolveSessionKey(sessionId);
		const handle = this.requireSession(sessionId);
		await this.applyPendingExecutionMode(handle.lifecycle.sessionId, handle);

		const sessionCwd = handle.workspaceView.readWorkingDirectory();
		if (sessionCwd && this.options.pathServices) {
			try {
				await this.options.pathServices.ensureDirectory(sessionCwd);
			} catch (error) {
				this.options.reportWorkspacePreparationFailure(error, handle.lifecycle.sessionId);
			}
		}

		try {
			if (handle.stateReader.readState().isStreaming && !request.streamingBehavior) {
				throw runtimeError("SESSION_BUSY", "Session is already processing another turn.", true, "runtime");
			}
			const outcome = await handle.turnControl.prompt({
				text: request.text,
				images: request.images,
				streamingBehavior: request.streamingBehavior,
				promptRef: request.promptRef,
				attachments: request.attachments,
				modelKey: request.modelKey,
				reasoning: request.reasoning,
				metadata: request.metadata,
			});
			return outcome ?? { status: "completed" };
		} catch (error) {
			const message = isSessionError(error) ? error.message : error instanceof Error ? error.message : String(error);
			const failure = isTurnPersistenceError(error) ? error.failure : undefined;
			if (failure && isTurnPersistenceError(error)) {
				return {
					status: "failed",
					turnId: error.turnId,
					error: { ...failure, retryable: false },
				};
			}
			this.options.events.broadcastSyntheticEvent(sessionKey, {
				...baseSessionEvent(handle.lifecycle.sessionId, "agent"),
				type: "error",
				...(isTurnPersistenceError(error) && error.turnId ? { turnId: error.turnId } : {}),
				error:
					failure ?? (isSessionError(error) ? error : runtimeError("INTERNAL_ERROR", message, false, "runtime")),
			});
			throw error;
		} finally {
			this.options.synchronizeSessionIdentity(sessionKey, handle);
		}
	}

	async continue(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await this.applyPendingExecutionMode(sessionId, handle);
		await handle.turnControl.continue();
	}

	async retry(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await this.applyPendingExecutionMode(sessionId, handle);
		await handle.turnControl.retry();
	}

	abort(sessionId: string): Promise<void> {
		return this.requireSession(sessionId).turnControl.abort();
	}

	getQueueState(sessionId: string): RuntimeSessionQueueStateView {
		return this.requireSession(sessionId).queueController?.readQueueState() ?? { paused: false, entries: [] };
	}

	removeQueuedMessage(sessionId: string, itemId: string): boolean {
		return this.requireSession(sessionId).queueController?.removeQueued(itemId) ?? false;
	}

	reorderQueuedMessages(sessionId: string, itemIds: readonly string[]): void {
		this.requireSession(sessionId).queueController?.reorderQueuedFollowUps(itemIds);
	}

	async sendQueuedMessageNow(sessionId: string, itemId: string): Promise<"promoted" | "started" | "missing"> {
		const controller = this.requireSession(sessionId).queueController;
		return controller ? controller.sendQueuedNow(itemId) : "missing";
	}

	async resumeQueue(sessionId: string): Promise<void> {
		await this.requireSession(sessionId).queueController?.resumeQueue();
	}

	clearQueue(sessionId: string): void {
		this.requireSession(sessionId).queueController?.clear();
	}

	async invokeSessionExtension<Input, Output>(
		sessionId: string,
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal?: AbortSignal,
	): Promise<Output> {
		const host = this.requireSession(sessionId).extensionHost;
		if (!host) throw new Error("Session extension host is unavailable");
		return host.invoke(token, input, signal);
	}

	hasSessionExtension<Input, Output>(sessionId: string, token: SessionExtensionEndpointToken<Input, Output>): boolean {
		return this.requireSession(sessionId).extensionHost?.hasEndpoint(token) ?? false;
	}

	invokeSessionExtensionSync<Input, Output>(
		sessionId: string,
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
	): Output {
		const host = this.requireSession(sessionId).extensionHost;
		if (!host) throw new Error("Session extension host is unavailable");
		return host.invokeSync(token, input);
	}

	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
		const sessionKey = this.options.directory.resolveSessionKey(sessionId);
		return this.options.events.subscribe(sessionKey, this.requireSession(sessionId), handler);
	}

	subscribeExecutionObservations(
		sessionId: string,
		handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		const stream = this.requireSession(sessionId).executionObservationStream;
		if (!stream) throw new Error("Session execution observation stream is unavailable");
		return stream.subscribe(handler);
	}

	readSessionContextCompactionState(sessionId: string): RuntimeContextCompactionState {
		return this.requireContextController(sessionId).readState();
	}

	compactSessionContext(
		sessionId: string,
		request?: RuntimeContextCompactionRequest,
	): Promise<RuntimeContextCompactionResult> {
		return this.requireContextController(sessionId).compact(request);
	}

	summarizeSessionContext(
		sessionId: string,
		request: RuntimeContextSummaryRequest,
	): Promise<RuntimeContextSummaryResult> {
		return this.requireContextController(sessionId).summarize(request);
	}

	abortSessionContextCompaction(sessionId: string): void {
		this.requireContextController(sessionId).abortCompaction();
	}

	async updateSettings(sessionId: string, partialSettings: SettingsPatch): Promise<void> {
		const handle = this.requireSession(sessionId);
		if (partialSettings.modelKey) await handle.modelController.selectModel(partialSettings.modelKey, "always");
		if (partialSettings.thinkingLevel) handle.modelController.setThinkingLevel(partialSettings.thinkingLevel);
		if (partialSettings.steeringMode) {
			handle.configurationController.setSteeringMode(partialSettings.steeringMode);
		}
		if (partialSettings.followUpMode) {
			handle.configurationController.setFollowUpMode(partialSettings.followUpMode);
		}
	}

	setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
		this.requireSession(sessionId).modelController.setThinkingLevel(level);
	}

	setSessionSteeringMode(sessionId: string, mode: NonNullable<SettingsPatch["steeringMode"]>): void {
		this.requireSession(sessionId).configurationController.setSteeringMode(mode);
	}

	setSessionFollowUpMode(sessionId: string, mode: NonNullable<SettingsPatch["followUpMode"]>): void {
		this.requireSession(sessionId).configurationController.setFollowUpMode(mode);
	}

	updateGlobalThinkingLevel(level: ThinkingLevel): void {
		for (const handle of this.options.directory.values()) handle.modelController.setThinkingLevel(level);
	}

	getState(sessionId: string): SessionStateSnapshot {
		const sessionKey = this.options.directory.resolveSessionKey(sessionId);
		const handle = this.requireSession(sessionId);
		const state = handle.stateReader.readState();
		return {
			sessionId: handle.lifecycle.sessionId,
			...(handle.lifecycle.agentId ? { agentId: handle.lifecycle.agentId } : {}),
			model: state.model,
			thinkingLevel: state.thinkingLevel,
			executionMode: handle.executionMode,
			isStreaming: state.isStreaming,
			currentTurnStartedAt: this.options.events.readCurrentTurnStartedAt(sessionKey),
			messageCount: state.messageCount,
			contextPercent: state.contextPercent,
			...(state.contextTokens !== undefined ? { contextTokens: state.contextTokens } : {}),
			contextWindow: state.contextWindow,
			...(state.contextComposition ? { contextComposition: state.contextComposition } : {}),
			activeToolNames: [...state.activeToolNames],
			parentSessionPath: state.parentSessionPath,
			parentEntryId: state.parentEntryId,
		};
	}

	readRuntimeSessionState(sessionId: string): RuntimeSessionState {
		const state = this.requireSession(sessionId).stateReader.readState();
		return { ...state, activeToolNames: [...state.activeToolNames] };
	}

	readSessionDocument(sessionId: string): ConversationDocument {
		const view = this.requireSession(sessionId).conversationView;
		if (!view) throw new Error("Session conversation view is unavailable");
		return view.readDocument();
	}

	readSessionWorkingDirectory(sessionId: string): string | undefined {
		return this.requireSession(sessionId).workspaceView.readWorkingDirectory();
	}

	getSessionDirectory(sessionId: string): string | undefined {
		return this.requireSession(sessionId).lifecycle.sessionDirectory;
	}

	readSessionContextUsage(sessionId: string): RuntimeSessionContextUsage | undefined {
		return this.requireSession(sessionId).contextUsageView?.readContextUsage();
	}

	readSessionCompactionState(sessionId: string): RuntimeContextCompactionState {
		return this.requireContextController(sessionId).readState();
	}

	setSessionAutoCompactionEnabled(sessionId: string, enabled: boolean): void {
		this.requireContextController(sessionId).setAutoCompactionEnabled(enabled);
	}

	deliverSessionContext(
		sessionId: string,
		records: readonly SessionContextRecord[],
		mode: RuntimeSessionContextDeliveryMode,
	): Promise<void> {
		const controller = this.requireSession(sessionId).contextDeliveryController;
		if (!controller) throw new Error("Session context delivery capability is unavailable");
		return controller.deliver(records, mode);
	}

	readSessionName(sessionId: string): string | undefined {
		return this.requireSession(sessionId).metadataController?.readName();
	}

	readSessionActiveToolNames(sessionId: string): readonly string[] {
		return [...(this.requireSession(sessionId).toolController?.readActiveToolNames() ?? [])];
	}

	readSessionAvailableTools(sessionId: string): ReadonlyMap<string, RuntimeToolDefinition> {
		return new Map(this.requireSession(sessionId).toolController?.readAvailableTools() ?? []);
	}

	setSessionActiveToolNames(sessionId: string, toolNames: readonly string[]): void {
		const controller = this.requireSession(sessionId).toolController;
		if (!controller) throw new Error("Session tool capability is unavailable");
		controller.setActiveToolNames(toolNames);
	}

	selectSessionModel(
		sessionId: string,
		modelKey: string,
		strategy: "if-changed" | "always" = "always",
	): Promise<void> {
		return this.requireSession(sessionId).modelController.selectModel(modelKey, strategy);
	}

	resolveSessionModelApiKey(sessionId: string, model: Model<Api>): Promise<string | undefined> {
		return this.requireSession(sessionId).modelView.resolveApiKey(model);
	}

	readSessionCurrentModel(sessionId: string): Model<Api> | undefined {
		return this.requireSession(sessionId).modelView.readCurrentModel();
	}

	readSessionAvailableModels(sessionId: string): readonly Model<Api>[] {
		return [...this.requireSession(sessionId).modelView.readAvailableModels()];
	}

	readSessionQueueModes(sessionId: string): {
		readonly steering: NonNullable<SettingsPatch["steeringMode"]>;
		readonly followUp: NonNullable<SettingsPatch["followUpMode"]>;
	} {
		const controller = this.requireQueueController(sessionId);
		return { steering: controller.readSteeringMode(), followUp: controller.readFollowUpMode() };
	}

	readSessionQueuedMessages(sessionId: string): {
		readonly steering: readonly string[];
		readonly followUp: readonly string[];
	} {
		const controller = this.requireQueueController(sessionId);
		return {
			steering: [...controller.readSteeringMessages()],
			followUp: [...controller.readFollowUpMessages()],
		};
	}

	clearSessionQueue(sessionId: string): {
		readonly steering: readonly string[];
		readonly followUp: readonly string[];
	} {
		return this.requireQueueController(sessionId).clear();
	}

	appendSessionBranchSummary(
		sessionId: string,
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): Promise<{ entryId: string }> {
		return this.requireSession(sessionId).historyController.appendBranchSummary(parentId, summary, details, fromHook);
	}

	appendSessionMetadataEntry(sessionId: string, customType: string, data?: unknown): Promise<void> {
		const controller = this.requireSession(sessionId).metadataController;
		if (!controller) throw new Error("Session metadata capability is unavailable");
		return controller.appendEntry(customType, data);
	}

	appendConversationMessage(
		sessionId: string,
		record: ConversationMessageRecord,
	): Promise<{ readonly entryId: string }> {
		const controller = this.requireSession(sessionId).conversationController;
		if (!controller) throw new Error("Session conversation write capability is unavailable");
		return controller.appendMessage(record);
	}

	setSessionLabel(sessionId: string, entryId: string, label: string | undefined): Promise<void> {
		const controller = this.requireSession(sessionId).metadataController;
		if (!controller) throw new Error("Session metadata capability is unavailable");
		return controller.setLabel(entryId, label);
	}

	getMessages(sessionId: string): Message[] {
		return [...this.requireSession(sessionId).stateReader.readMessages()];
	}

	getFullHistory(sessionId: string): HistoryEntry[] {
		return [...this.requireSession(sessionId).historyReader.readHistory()];
	}

	navigateForEdit(sessionId: string, entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return this.requireSession(sessionId).historyController.navigateForEdit(entryId);
	}

	switchBranch(sessionId: string, entryId: string): Promise<{ leafId: string }> {
		return this.requireSession(sessionId).historyController.switchBranch(entryId);
	}

	deleteMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }> {
		return this.requireSession(sessionId).historyController.deleteMessage(entryId);
	}

	replaceLastUserMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }> {
		return this.requireSession(sessionId).historyController.replaceLastUserMessage(entryId);
	}

	forkSession(sessionId: string, entryId: string): Promise<{ path: string; text: string }> {
		return this.requireSession(sessionId).historyController.forkSession(entryId);
	}

	renameSessionById(sessionId: string, name: string): Promise<void> {
		return this.requireSession(sessionId).historyController.setName(name);
	}

	getSessionPath(sessionId: string): string | undefined {
		try {
			return this.requireSession(sessionId).lifecycle.sessionPath;
		} catch {
			return undefined;
		}
	}

	private requireSession(sessionId: string): RuntimeHostSessionRecord {
		return this.options.directory.get(sessionId);
	}

	private requireQueueController(sessionId: string): RuntimeSessionQueueController {
		const controller = this.requireSession(sessionId).queueController;
		if (!controller) throw new Error("Session queue capability is unavailable");
		return controller;
	}

	private requireContextController(sessionId: string) {
		const controller = this.requireSession(sessionId).contextController;
		if (!controller) throw new Error("Session context controller is unavailable");
		return controller;
	}

	private async applyExecutionMode(
		sessionId: string,
		handle: RuntimeHostSessionRecord,
		mode: SessionExecutionMode,
	): Promise<void> {
		await handle.executionController.reconfigure({
			mode,
			sessionId,
			sandboxHostPath: this.options.sandboxHostPath,
			linuxBubblewrapPath: this.options.linuxBubblewrapPath,
			macosSandboxExecPath: this.options.macosSandboxExecPath,
		});
		handle.executionMode = mode;
	}

	private async applyPendingExecutionMode(sessionId: string, handle: RuntimeHostSessionRecord): Promise<void> {
		if (!handle.pendingConfiguration.hasExecutionMode || handle.executionController.isBusy()) return;
		const pendingExecutionMode = handle.pendingConfiguration.executionMode;
		if (!pendingExecutionMode) return;
		handle.pendingConfiguration.executionMode = undefined;
		handle.pendingConfiguration.hasExecutionMode = false;
		try {
			await this.applyExecutionMode(sessionId, handle, pendingExecutionMode);
		} catch (error) {
			if (!handle.pendingConfiguration.hasExecutionMode) {
				handle.pendingConfiguration.executionMode = pendingExecutionMode;
				handle.pendingConfiguration.hasExecutionMode = true;
			}
			throw error;
		}
	}
}
