import type { CodingAgentSessionEventListener } from "../../public-api/sdk/sdk-event-contract.js";
import type { CodingAgentPromptOptions } from "../../public-api/sdk/sdk-prompt-contract.js";
import type { CodingAgentFixedSession } from "../../public-api/sdk/sdk-session-contract.js";
import type { CodingAgentSdkSessionRuntimePort } from "./runtime-contracts.js";
import { mapCodingAgentSdkExecutionEvent } from "./session-events.js";

/** Runtime 到稳定 SDK 核心会话语义的门面。 */
export class CodingAgentSdkSessionAdapter implements CodingAgentFixedSession {
	private readonly listeners = new Set<CodingAgentSessionEventListener>();
	private readonly unsubscribeExecutionObservation: () => void;
	private readonly unsubscribeRetryEvents: () => void;
	private closePromise: Promise<void> | undefined;
	private closed = false;

	constructor(
		private readonly runtime: CodingAgentSdkSessionRuntimePort,
		private readonly onClosed?: () => void,
	) {
		this.unsubscribeExecutionObservation = runtime.subscribeExecutionObservation((observation) => {
			this.emit(mapCodingAgentSdkExecutionEvent(observation));
		});
		this.unsubscribeRetryEvents = runtime.capabilities.subscribeRetryEvents((event) => this.emit(event));
	}

	get sessionId(): string {
		return this.runtime.sessionId;
	}

	get sessionFile(): string | undefined {
		return this.runtime.sessionPath;
	}

	get state(): CodingAgentFixedSession["state"] {
		return this.runtime.readState();
	}

	get model(): CodingAgentFixedSession["model"] {
		return this.state.model;
	}

	get thinkingLevel(): CodingAgentFixedSession["thinkingLevel"] {
		return this.state.thinkingLevel;
	}

	get isStreaming(): boolean {
		return this.state.isStreaming;
	}

	get messages(): CodingAgentFixedSession["messages"] {
		return this.runtime.readMessages();
	}

	get retryAttempt(): number {
		return this.runtime.capabilities.readRetryAttempt();
	}

	get agentMode(): string | undefined {
		return this.runtime.capabilities.readAgentMode();
	}

	get isCompacting(): boolean {
		return this.runtime.capabilities.readIsCompacting();
	}

	get steeringMode(): CodingAgentFixedSession["steeringMode"] {
		return this.runtime.capabilities.readSteeringMode();
	}

	get followUpMode(): CodingAgentFixedSession["followUpMode"] {
		return this.runtime.capabilities.readFollowUpMode();
	}

	get sessionName(): string | undefined {
		return this.runtime.capabilities.readSessionName();
	}

	get scopedModels(): CodingAgentFixedSession["scopedModels"] {
		return this.runtime.capabilities.readScopedModels();
	}

	get pendingMessageCount(): number {
		return this.runtime.capabilities.readPendingMessageCount();
	}

	get autoCompactionEnabled(): boolean {
		return this.runtime.capabilities.readAutoCompactionEnabled();
	}

	get isRetrying(): boolean {
		return this.runtime.capabilities.readIsRetrying();
	}

	get autoRetryEnabled(): boolean {
		return this.runtime.capabilities.readAutoRetryEnabled();
	}

	async prompt(text: string, options: CodingAgentPromptOptions = {}): Promise<void> {
		this.assertOpen();
		await this.runtime.prompt({
			text,
			attachments: options.attachments,
			images: options.images,
			metadata: options.metadata,
			promptRef: options.promptRef,
			streamingBehavior: options.streamingBehavior,
		});
	}

	async steer(text: string, images?: CodingAgentPromptOptions["images"]): Promise<void> {
		await this.prompt(text, { images, streamingBehavior: "steer" });
	}

	async followUp(text: string, images?: CodingAgentPromptOptions["images"]): Promise<void> {
		await this.prompt(text, { images, streamingBehavior: "followUp" });
	}

	abort(): Promise<void> {
		this.assertOpen();
		return this.runtime.abort();
	}

	setModel(model: NonNullable<CodingAgentFixedSession["model"]>): Promise<void> {
		this.assertOpen();
		return this.runtime.selectModel(`${model.provider}/${model.id}`);
	}

	setThinkingLevel(level: CodingAgentFixedSession["thinkingLevel"]): void {
		this.assertOpen();
		this.runtime.setThinkingLevel(level);
	}

	getActiveToolNames(): ReturnType<CodingAgentFixedSession["getActiveToolNames"]> {
		return this.runtime.capabilities.readActiveToolNames();
	}

	getAllTools(): ReturnType<CodingAgentFixedSession["getAllTools"]> {
		return this.runtime.capabilities.readAllTools();
	}

	setActiveToolsByName(toolNames: readonly string[]): void {
		this.assertOpen();
		this.runtime.capabilities.setActiveToolNames(toolNames);
	}

	reconfigureCustomTools(customTools: Parameters<CodingAgentFixedSession["reconfigureCustomTools"]>[0]): void {
		this.assertOpen();
		this.runtime.capabilities.reconfigureCustomTools(customTools);
	}

	setAgentMode(mode: string | undefined): void {
		this.assertOpen();
		this.runtime.capabilities.setAgentMode(mode);
	}

	setScopedModels(scopedModels: CodingAgentFixedSession["scopedModels"]): void {
		this.assertOpen();
		this.runtime.capabilities.setScopedModels(scopedModels);
	}

	clearQueue(): ReturnType<CodingAgentFixedSession["clearQueue"]> {
		this.assertOpen();
		return this.runtime.capabilities.clearQueue();
	}

	getSteeringMessages(): readonly string[] {
		return this.runtime.capabilities.readSteeringMessages();
	}

	getFollowUpMessages(): readonly string[] {
		return this.runtime.capabilities.readFollowUpMessages();
	}

	cycleModel(direction?: "forward" | "backward"): ReturnType<CodingAgentFixedSession["cycleModel"]> {
		this.assertOpen();
		return this.runtime.capabilities.cycleModel(direction);
	}

	cycleThinkingLevel(): ReturnType<CodingAgentFixedSession["cycleThinkingLevel"]> {
		this.assertOpen();
		return this.runtime.capabilities.cycleThinkingLevel();
	}

	getAvailableThinkingLevels(): ReturnType<CodingAgentFixedSession["getAvailableThinkingLevels"]> {
		return this.runtime.capabilities.readAvailableThinkingLevels();
	}

	supportsXhighThinking(): boolean {
		return this.runtime.capabilities.supportsXhighThinking();
	}

	supportsThinking(): boolean {
		return this.runtime.capabilities.supportsThinking();
	}

	setSteeringMode(mode: CodingAgentFixedSession["steeringMode"]): void {
		this.assertOpen();
		this.runtime.capabilities.setSteeringMode(mode);
	}

	setFollowUpMode(mode: CodingAgentFixedSession["followUpMode"]): void {
		this.assertOpen();
		this.runtime.capabilities.setFollowUpMode(mode);
	}

	compact(customInstructions?: string, signal?: AbortSignal): ReturnType<CodingAgentFixedSession["compact"]> {
		this.assertOpen();
		return this.runtime.capabilities.compact(customInstructions, signal);
	}

	abortCompaction(): void {
		this.runtime.capabilities.abortCompaction();
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		this.runtime.capabilities.setAutoCompactionEnabled(enabled);
	}

	abortRetry(): void {
		this.runtime.capabilities.abortRetry();
	}

	setAutoRetryEnabled(enabled: boolean): void {
		this.runtime.capabilities.setAutoRetryEnabled(enabled);
	}

	setSessionName(name: string): Promise<void> {
		this.assertOpen();
		return this.runtime.capabilities.setSessionName(name);
	}

	getSessionStats(): ReturnType<CodingAgentFixedSession["getSessionStats"]> {
		return this.runtime.capabilities.readSessionStats();
	}

	getContextUsage(): ReturnType<CodingAgentFixedSession["getContextUsage"]> {
		return this.runtime.capabilities.readContextUsage();
	}

	getLastAssistantText(): string | undefined {
		return this.runtime.capabilities.readLastAssistantText();
	}

	listSubagents(): ReturnType<CodingAgentFixedSession["listSubagents"]> {
		return this.runtime.capabilities.readSubagents();
	}

	interruptSubagent(target: string): ReturnType<CodingAgentFixedSession["interruptSubagent"]> {
		this.assertOpen();
		return this.runtime.capabilities.interruptSubagent(target);
	}

	clearFinishedSubagents(): number {
		this.assertOpen();
		return this.runtime.capabilities.clearFinishedSubagents();
	}

	listAvailableModels(): ReturnType<CodingAgentFixedSession["listAvailableModels"]> {
		return this.runtime.capabilities.readAvailableModels();
	}

	getSystemPrompt(): string {
		return this.runtime.capabilities.readSystemPrompt();
	}

	getSkills(): ReturnType<CodingAgentFixedSession["getSkills"]> {
		return this.runtime.capabilities.readSkills();
	}

	getPromptTemplates(): ReturnType<CodingAgentFixedSession["getPromptTemplates"]> {
		return this.runtime.capabilities.readPromptTemplates();
	}

	reconfigureAgentPlugins(
		agentPlugins: Parameters<CodingAgentFixedSession["reconfigureAgentPlugins"]>[0],
	): Promise<void> {
		this.assertOpen();
		return this.runtime.capabilities.reconfigureAgentPlugins(agentPlugins);
	}

	listBackgroundTasks(): ReturnType<CodingAgentFixedSession["listBackgroundTasks"]> {
		return this.runtime.capabilities.readBackgroundTasks();
	}

	killBackgroundTask(taskId: string): boolean {
		this.assertOpen();
		return this.runtime.capabilities.killBackgroundTask(taskId);
	}

	clearFinishedBackgroundTasks(): number {
		this.assertOpen();
		return this.runtime.capabilities.clearFinishedBackgroundTasks();
	}

	getTodos(): ReturnType<CodingAgentFixedSession["getTodos"]> {
		return this.runtime.capabilities.readTodos();
	}

	clearTodos(): boolean {
		this.assertOpen();
		return this.runtime.capabilities.clearTodos();
	}

	getMemoryConfiguration(): ReturnType<CodingAgentFixedSession["getMemoryConfiguration"]> {
		return this.runtime.capabilities.readMemoryConfiguration();
	}

	flushMemory(signal?: AbortSignal): Promise<number> {
		this.assertOpen();
		return this.runtime.capabilities.flushMemory(signal);
	}

	reloadMcp(): Promise<void> {
		this.assertOpen();
		return this.runtime.capabilities.reloadMcp();
	}

	reload(): Promise<void> {
		this.assertOpen();
		return this.runtime.capabilities.reload();
	}

	exportToHtml(outputPath?: string): Promise<string> {
		this.assertOpen();
		return this.runtime.capabilities.exportToHtml(outputPath);
	}

	hasExtensionHandlers(eventType: string): boolean {
		return this.runtime.capabilities.hasExtensionHandlers(eventType);
	}

	subscribe(listener: CodingAgentSessionEventListener): () => void {
		this.assertOpen();
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		void this.close();
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closed = true;
		this.unsubscribeExecutionObservation();
		this.unsubscribeRetryEvents();
		this.listeners.clear();
		const operation = this.runtime.dispose().then(() => this.onClosed?.());
		const tracked = operation.catch((error: unknown) => {
			if (this.closePromise === tracked) this.closePromise = undefined;
			throw error;
		});
		this.closePromise = tracked;
		return tracked;
	}

	private emit(event: Parameters<CodingAgentSessionEventListener>[0]): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error: unknown) {
				console.warn("[CodingAgentSdkSessionAdapter] Event listener failed", error);
			}
		}
	}

	private assertOpen(): void {
		if (this.closed) throw new Error("AgentSession is closed");
	}
}
