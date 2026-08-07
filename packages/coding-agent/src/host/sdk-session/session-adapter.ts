import type {
	GreenfieldSdkPromptOptions,
	GreenfieldSdkSession,
	GreenfieldSdkSessionEventListener,
	GreenfieldSdkSessionRuntimePort,
} from "./runtime-contracts.js";
import { mapGreenfieldSdkExecutionEvent } from "./session-events.js";

/** Greenfield Runtime 到现有 SDK 核心会话语义的并行兼容门面。 */
export class GreenfieldSdkSessionAdapter implements GreenfieldSdkSession {
	private readonly listeners = new Set<GreenfieldSdkSessionEventListener>();
	private readonly unsubscribeExecutionObservation: () => void;
	private readonly unsubscribeRetryEvents: () => void;
	private closePromise: Promise<void> | undefined;
	private closed = false;

	constructor(
		private readonly runtime: GreenfieldSdkSessionRuntimePort,
		private readonly onClosed?: () => void,
	) {
		this.unsubscribeExecutionObservation = runtime.subscribeExecutionObservation((observation) => {
			this.emit(mapGreenfieldSdkExecutionEvent(observation));
		});
		this.unsubscribeRetryEvents = runtime.capabilities.subscribeRetryEvents((event) => this.emit(event));
	}

	get sessionId(): string {
		return this.runtime.sessionId;
	}

	get sessionFile(): string | undefined {
		return this.runtime.sessionPath;
	}

	get state(): GreenfieldSdkSession["state"] {
		return this.runtime.readState();
	}

	get model(): GreenfieldSdkSession["model"] {
		return this.state.model;
	}

	get thinkingLevel(): GreenfieldSdkSession["thinkingLevel"] {
		return this.state.thinkingLevel;
	}

	get isStreaming(): boolean {
		return this.state.isStreaming;
	}

	get messages(): GreenfieldSdkSession["messages"] {
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

	get steeringMode(): GreenfieldSdkSession["steeringMode"] {
		return this.runtime.capabilities.readSteeringMode();
	}

	get followUpMode(): GreenfieldSdkSession["followUpMode"] {
		return this.runtime.capabilities.readFollowUpMode();
	}

	get sessionName(): string | undefined {
		return this.runtime.capabilities.readSessionName();
	}

	get scopedModels(): GreenfieldSdkSession["scopedModels"] {
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

	async prompt(text: string, options: GreenfieldSdkPromptOptions = {}): Promise<void> {
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

	async steer(text: string, images?: GreenfieldSdkPromptOptions["images"]): Promise<void> {
		await this.prompt(text, { images, streamingBehavior: "steer" });
	}

	async followUp(text: string, images?: GreenfieldSdkPromptOptions["images"]): Promise<void> {
		await this.prompt(text, { images, streamingBehavior: "followUp" });
	}

	abort(): Promise<void> {
		this.assertOpen();
		return this.runtime.abort();
	}

	setModel(model: NonNullable<GreenfieldSdkSession["model"]>): Promise<void> {
		this.assertOpen();
		return this.runtime.selectModel(`${model.provider}/${model.id}`);
	}

	setThinkingLevel(level: GreenfieldSdkSession["thinkingLevel"]): void {
		this.assertOpen();
		this.runtime.setThinkingLevel(level);
	}

	getActiveToolNames(): ReturnType<GreenfieldSdkSession["getActiveToolNames"]> {
		return this.runtime.capabilities.readActiveToolNames();
	}

	getAllTools(): ReturnType<GreenfieldSdkSession["getAllTools"]> {
		return this.runtime.capabilities.readAllTools();
	}

	setActiveToolsByName(toolNames: readonly string[]): void {
		this.assertOpen();
		this.runtime.capabilities.setActiveToolNames(toolNames);
	}

	reconfigureCustomTools(customTools: Parameters<GreenfieldSdkSession["reconfigureCustomTools"]>[0]): void {
		this.assertOpen();
		this.runtime.capabilities.reconfigureCustomTools(customTools);
	}

	setAgentMode(mode: string | undefined): void {
		this.assertOpen();
		this.runtime.capabilities.setAgentMode(mode);
	}

	setScopedModels(scopedModels: GreenfieldSdkSession["scopedModels"]): void {
		this.assertOpen();
		this.runtime.capabilities.setScopedModels(scopedModels);
	}

	clearQueue(): ReturnType<GreenfieldSdkSession["clearQueue"]> {
		this.assertOpen();
		return this.runtime.capabilities.clearQueue();
	}

	getSteeringMessages(): readonly string[] {
		return this.runtime.capabilities.readSteeringMessages();
	}

	getFollowUpMessages(): readonly string[] {
		return this.runtime.capabilities.readFollowUpMessages();
	}

	cycleModel(direction?: "forward" | "backward"): ReturnType<GreenfieldSdkSession["cycleModel"]> {
		this.assertOpen();
		return this.runtime.capabilities.cycleModel(direction);
	}

	cycleThinkingLevel(): ReturnType<GreenfieldSdkSession["cycleThinkingLevel"]> {
		this.assertOpen();
		return this.runtime.capabilities.cycleThinkingLevel();
	}

	getAvailableThinkingLevels(): ReturnType<GreenfieldSdkSession["getAvailableThinkingLevels"]> {
		return this.runtime.capabilities.readAvailableThinkingLevels();
	}

	supportsXhighThinking(): boolean {
		return this.runtime.capabilities.supportsXhighThinking();
	}

	supportsThinking(): boolean {
		return this.runtime.capabilities.supportsThinking();
	}

	setSteeringMode(mode: GreenfieldSdkSession["steeringMode"]): void {
		this.assertOpen();
		this.runtime.capabilities.setSteeringMode(mode);
	}

	setFollowUpMode(mode: GreenfieldSdkSession["followUpMode"]): void {
		this.assertOpen();
		this.runtime.capabilities.setFollowUpMode(mode);
	}

	compact(customInstructions?: string, signal?: AbortSignal): ReturnType<GreenfieldSdkSession["compact"]> {
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

	getSessionStats(): ReturnType<GreenfieldSdkSession["getSessionStats"]> {
		return this.runtime.capabilities.readSessionStats();
	}

	getContextUsage(): ReturnType<GreenfieldSdkSession["getContextUsage"]> {
		return this.runtime.capabilities.readContextUsage();
	}

	getLastAssistantText(): string | undefined {
		return this.runtime.capabilities.readLastAssistantText();
	}

	listSubagents(): ReturnType<GreenfieldSdkSession["listSubagents"]> {
		return this.runtime.capabilities.readSubagents();
	}

	interruptSubagent(target: string): ReturnType<GreenfieldSdkSession["interruptSubagent"]> {
		this.assertOpen();
		return this.runtime.capabilities.interruptSubagent(target);
	}

	clearFinishedSubagents(): number {
		this.assertOpen();
		return this.runtime.capabilities.clearFinishedSubagents();
	}

	listAvailableModels(): ReturnType<GreenfieldSdkSession["listAvailableModels"]> {
		return this.runtime.capabilities.readAvailableModels();
	}

	getSystemPrompt(): string {
		return this.runtime.capabilities.readSystemPrompt();
	}

	getSkills(): ReturnType<GreenfieldSdkSession["getSkills"]> {
		return this.runtime.capabilities.readSkills();
	}

	getPromptTemplates(): ReturnType<GreenfieldSdkSession["getPromptTemplates"]> {
		return this.runtime.capabilities.readPromptTemplates();
	}

	reconfigureAgentPlugins(
		agentPlugins: Parameters<GreenfieldSdkSession["reconfigureAgentPlugins"]>[0],
	): Promise<void> {
		this.assertOpen();
		return this.runtime.capabilities.reconfigureAgentPlugins(agentPlugins);
	}

	listBackgroundTasks(): ReturnType<GreenfieldSdkSession["listBackgroundTasks"]> {
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

	getTodos(): ReturnType<GreenfieldSdkSession["getTodos"]> {
		return this.runtime.capabilities.readTodos();
	}

	clearTodos(): boolean {
		this.assertOpen();
		return this.runtime.capabilities.clearTodos();
	}

	getMemoryConfiguration(): ReturnType<GreenfieldSdkSession["getMemoryConfiguration"]> {
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

	subscribe(listener: GreenfieldSdkSessionEventListener): () => void {
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

	private emit(event: Parameters<GreenfieldSdkSessionEventListener>[0]): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error: unknown) {
				console.warn("[GreenfieldSdkSessionAdapter] Event listener failed", error);
			}
		}
	}

	private assertOpen(): void {
		if (this.closed) throw new Error("AgentSession is closed");
	}
}
