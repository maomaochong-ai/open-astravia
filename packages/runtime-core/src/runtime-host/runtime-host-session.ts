import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Message, Model } from "@vetta/ai";
import type {
	HistoryEntry,
	PromptRequest,
	RuntimeTurnPromptOutcome,
	SessionEvent,
	SessionStateSnapshot,
	SettingsPatch,
} from "../contracts.js";
import type { ConversationDocument } from "../conversation/document.js";
import type { RuntimeToolDefinition, SessionContextRecord } from "../kernel/contracts.js";
import type { SessionExtensionEndpointToken } from "../session-extensions/contracts.js";
import type { RuntimeActiveSession } from "./active-session-host-contracts.js";
import type { RuntimeHost } from "./runtime-host.js";
import type {
	RuntimeContextCompactionResult,
	RuntimeContextCompactionState,
	RuntimeSessionContextDeliveryMode,
	RuntimeSessionContextUsage,
	RuntimeSessionExecutionObservation,
} from "./session-ports.js";

/**
 * RuntimeHost 已拥有 Session 的 scoped view。
 *
 * 该对象不缓存状态、不持有 Backend/Kernel，也不建立第二套释放路径；所有操作都回到
 * 唯一 RuntimeHost，并在 sessionId 已释放后 fail-closed。
 */
export class RuntimeHostSession implements RuntimeActiveSession {
	constructor(
		private readonly host: RuntimeHost,
		private readonly initialSessionId: string,
	) {}

	get sessionId(): string {
		return this.host.readCanonicalSessionId(this.initialSessionId);
	}

	get sessionPath(): string | undefined {
		return this.host.getSessionPath(this.sessionId);
	}

	get sessionDirectory(): string | undefined {
		return this.host.getSessionDirectory(this.sessionId);
	}

	async prompt(request: PromptRequest): Promise<RuntimeTurnPromptOutcome & { readonly sessionId: string }> {
		const outcome = await this.host.prompt(this.sessionId, request);
		return { ...outcome, sessionId: this.sessionId };
	}

	continue(): Promise<void> {
		return this.host.continue(this.sessionId);
	}

	retry(): Promise<void> {
		return this.host.retry(this.sessionId);
	}

	abort(_reason?: string): Promise<void> {
		return this.host.abort(this.sessionId);
	}

	readState(): SessionStateSnapshot {
		return this.host.getState(this.sessionId);
	}

	readMessages(): readonly Message[] {
		return this.host.getMessages(this.sessionId);
	}

	readHistory(): readonly HistoryEntry[] {
		return this.host.getFullHistory(this.sessionId);
	}

	subscribe(handler: (event: SessionEvent) => void): () => void {
		return this.host.subscribe(this.sessionId, handler);
	}

	subscribeExecutionObservations(
		handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		return this.host.subscribeExecutionObservations(this.sessionId, handler);
	}

	navigateForEdit(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return this.host.navigateForEdit(this.sessionId, entryId);
	}

	forkSession(entryId: string): Promise<{ path: string; text: string }> {
		return this.host.forkSession(this.sessionId, entryId);
	}

	switchBranch(entryId: string): Promise<{ leafId: string }> {
		return this.host.switchBranch(this.sessionId, entryId);
	}

	appendBranchSummary(
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): Promise<{ entryId: string }> {
		return this.host.appendSessionBranchSummary(this.sessionId, parentId, summary, details, fromHook);
	}

	deleteMessage(entryId: string): Promise<{ leafId: string | null }> {
		return this.host.deleteMessage(this.sessionId, entryId);
	}

	replaceLastUserMessage(entryId: string): Promise<{ leafId: string | null }> {
		return this.host.replaceLastUserMessage(this.sessionId, entryId);
	}

	readDocument(): ConversationDocument {
		return this.host.readSessionDocument(this.sessionId);
	}

	readWorkingDirectory(): string | undefined {
		return this.host.readSessionWorkingDirectory(this.sessionId);
	}

	readContextUsage(): RuntimeSessionContextUsage | undefined {
		return this.host.readSessionContextUsage(this.sessionId);
	}

	readCompactionState(): RuntimeContextCompactionState {
		return this.host.readSessionCompactionState(this.sessionId);
	}

	compact(customInstructions?: string): Promise<RuntimeContextCompactionResult> {
		return this.host.compactSessionContext(
			this.sessionId,
			customInstructions === undefined ? undefined : { customInstructions },
		);
	}

	abortCompaction(): void {
		this.host.abortSessionContextCompaction(this.sessionId);
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		this.host.setSessionAutoCompactionEnabled(this.sessionId, enabled);
	}

	deliverContext(records: readonly SessionContextRecord[], mode: RuntimeSessionContextDeliveryMode): Promise<void> {
		return this.host.deliverSessionContext(this.sessionId, records, mode);
	}

	readName(): string | undefined {
		return this.host.readSessionName(this.sessionId);
	}

	setName(name: string): Promise<void> {
		return this.host.renameSessionById(this.sessionId, name);
	}

	readActiveToolNames(): readonly string[] {
		return this.host.readSessionActiveToolNames(this.sessionId);
	}

	readAvailableTools(): ReadonlyMap<string, RuntimeToolDefinition> {
		return this.host.readSessionAvailableTools(this.sessionId);
	}

	setActiveToolNames(toolNames: readonly string[]): void {
		this.host.setSessionActiveToolNames(this.sessionId, toolNames);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.host.setSessionThinkingLevel(this.sessionId, level);
	}

	setSteeringMode(mode: NonNullable<SettingsPatch["steeringMode"]>): void {
		this.host.setSessionSteeringMode(this.sessionId, mode);
	}

	setFollowUpMode(mode: NonNullable<SettingsPatch["followUpMode"]>): void {
		this.host.setSessionFollowUpMode(this.sessionId, mode);
	}

	readCurrentModel(): Model<Api> | undefined {
		return this.host.readSessionCurrentModel(this.sessionId);
	}

	readAvailableModels(): readonly Model<Api>[] {
		return this.host.readSessionAvailableModels(this.sessionId);
	}

	selectModel(modelKey: string, strategy: "if-changed" | "always" = "always"): Promise<void> {
		return this.host.selectSessionModel(this.sessionId, modelKey, strategy);
	}

	resolveModelApiKey(model: Model<Api>): Promise<string | undefined> {
		return this.host.resolveSessionModelApiKey(this.sessionId, model);
	}

	updateSettings(settings: SettingsPatch): Promise<void> {
		return this.host.updateSettings(this.sessionId, settings);
	}

	readQueueModes(): {
		readonly steering: NonNullable<SettingsPatch["steeringMode"]>;
		readonly followUp: NonNullable<SettingsPatch["followUpMode"]>;
	} {
		return this.host.readSessionQueueModes(this.sessionId);
	}

	readQueuedMessages(): { readonly steering: readonly string[]; readonly followUp: readonly string[] } {
		return this.host.readSessionQueuedMessages(this.sessionId);
	}

	clearQueue(): { readonly steering: readonly string[]; readonly followUp: readonly string[] } {
		return this.host.clearSessionQueue(this.sessionId);
	}

	readPendingMessageCount(): number {
		return this.host.getQueueState(this.sessionId).entries.length;
	}

	appendMetadataEntry(customType: string, data?: unknown): Promise<void> {
		return this.host.appendSessionMetadataEntry(this.sessionId, customType, data);
	}

	setLabel(entryId: string, label: string | undefined): Promise<void> {
		return this.host.setSessionLabel(this.sessionId, entryId, label);
	}

	hasExtension<Input, Output>(token: SessionExtensionEndpointToken<Input, Output>): boolean {
		return this.host.hasSessionExtension(this.sessionId, token);
	}

	invokeExtension<Input, Output>(
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal?: AbortSignal,
	): Promise<Output> {
		return this.host.invokeSessionExtension(this.sessionId, token, input, signal);
	}

	invokeExtensionSync<Input, Output>(token: SessionExtensionEndpointToken<Input, Output>, input: Input): Output {
		return this.host.invokeSessionExtensionSync(this.sessionId, token, input);
	}

	dispose(): Promise<void> {
		return this.host.disposeSession(this.sessionId);
	}
}
