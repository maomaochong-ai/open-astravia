import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type { PromptRequest, RuntimeSessionInputQueueMode } from "@vetta/runtime-core";
import {
	CODING_AGENT_BACKGROUND_TASK_KILL,
	CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED,
	CODING_AGENT_BACKGROUND_TASKS_READ,
	CODING_AGENT_SUBAGENT_INTERRUPT,
	CODING_AGENT_SUBAGENTS_CLEAR_FINISHED,
	CODING_AGENT_SUBAGENTS_READ,
} from "../../execution/background/background-work-session-extension-contract.js";
import type { CodingAgentTurnRetryController } from "../../execution/turn/contracts.js";
import { readCodingAgentTurnFailure } from "../../execution/turn/turn-executor.js";
import { createCodingAgentTurnRetryController } from "../../execution/turn/turn-retry-controller.js";
import {
	CODING_AGENT_TODO_CLEAR,
	CODING_AGENT_TODO_READ,
} from "../../features/todo/todo-session-extension-contract.js";
import type { AgentPluginRuntimeConfig } from "../../model-context/plugin-runtime.js";
import { CODING_AGENT_PLUGIN_CONFIGURATION_APPLY } from "../../plugins/runtime/plugin-configuration-session-extension-contract.js";
import type { CodingAgentRetryEvent } from "../../public-api/sdk/sdk-event-contract.js";
import type {
	CodingAgentMemoryConfiguration,
	CodingAgentModelCycleResult,
	CodingAgentPromptTemplate,
	CodingAgentScopedModel,
	CodingAgentSkillInfo,
	CodingAgentToolInfo,
} from "../../public-api/sdk/sdk-session-contract.js";
import type { CodingAgentSessionToolDefinition } from "../../public-api/sdk/sdk-tool-contract.js";
import { projectCodingAgentMessages } from "../../sessions/projection/conversation-context-projector.js";
import { CODING_AGENT_SESSION_AGENT_MODE_SET } from "../session-configuration/session-profile-state-extension-contract.js";
import type { CodingAgentSdkSessionCapabilityPort } from "./runtime-contracts.js";
import type { CodingAgentSdkSessionCapabilityHostOptions } from "./session-capability-options.js";
import { computeSdkSessionStats, readLastAssistantText, toSdkToolInfo } from "./session-capability-projections.js";
import { CodingAgentSessionModelCapabilities } from "./session-model-capabilities.js";

export type {
	CodingAgentSdkSessionCapabilityHostOptions,
	CodingAgentSdkSessionCapabilitySettings,
} from "./session-capability-options.js";

/** SDK 与 RPC 共用的 Session 内操作能力；不拥有 Session，也不执行身份迁移。 */
export class CodingAgentSdkSessionCapabilityHost implements CodingAgentSdkSessionCapabilityPort {
	private scopedModels: CodingAgentScopedModel[];
	private agentMode: string | undefined;
	private readonly retryController: CodingAgentTurnRetryController | undefined;
	private readonly retryListeners = new Set<(event: CodingAgentRetryEvent) => void>();
	private readonly modelCapabilities: CodingAgentSessionModelCapabilities;

	constructor(private readonly options: CodingAgentSdkSessionCapabilityHostOptions) {
		this.scopedModels = [...(options.scopedModels ?? [])];
		this.agentMode = options.initialAgentMode;
		this.modelCapabilities = new CodingAgentSessionModelCapabilities({
			readSession: () => this.options.readSession(),
			readAvailableModels: () => this.readAvailableModelSource(),
			readScopedModels: () => this.scopedModels,
			settings: options.settings,
		});
		const settings = options.settings;
		this.retryController =
			options.retryController ??
			(settings
				? createCodingAgentTurnRetryController({
						readSettings: () => settings.getRetrySettings(),
						setEnabled: (enabled) => settings.setRetryEnabled(enabled),
						emit: (event) => {
							for (const listener of this.retryListeners) listener(event);
						},
					})
				: undefined);
	}

	async prompt(request: PromptRequest): Promise<unknown> {
		if (!request.streamingBehavior) await this.options.beforePrompt?.();
		const executeInitial = () => this.options.readSession().prompt(request);
		const retryController = this.retryController;
		const result = retryController
			? await retryController.run(
					executeInitial,
					() => this.options.readSession().retry(),
					readCodingAgentTurnFailure,
				)
			: await executeInitial();
		const failure = readCodingAgentTurnFailure(result);
		if (failure) throw new Error(failure.message);
		return result;
	}

	subscribeRetryEvents(handler: (event: CodingAgentRetryEvent) => void): () => void {
		this.retryListeners.add(handler);
		return () => this.retryListeners.delete(handler);
	}

	readRetryAttempt(): number {
		return this.retryController?.retryAttempt ?? 0;
	}

	readActiveToolNames(): readonly string[] {
		return this.options.readSession().readActiveToolNames();
	}

	readAllTools(): readonly CodingAgentToolInfo[] {
		return toSdkToolInfo(this.options.readSession().readAvailableTools());
	}

	setActiveToolNames(toolNames: readonly string[]): void {
		this.options.readSession().setActiveToolNames(toolNames);
	}

	reconfigureCustomTools(customTools: readonly CodingAgentSessionToolDefinition[] | undefined): void {
		if (!this.options.reconfigureCustomTools) {
			throw new Error("Session custom tool capability is unavailable");
		}
		this.options.reconfigureCustomTools(customTools);
	}

	readAgentMode(): string | undefined {
		return this.agentMode;
	}

	setAgentMode(mode: string | undefined): void {
		const session = this.options.readSession();
		if (!session.hasExtension(CODING_AGENT_SESSION_AGENT_MODE_SET)) {
			throw new Error("Session Agent Mode capability is unavailable");
		}
		session.invokeExtensionSync(CODING_AGENT_SESSION_AGENT_MODE_SET, { agentMode: mode });
		this.agentMode = mode;
	}

	readIsCompacting(): boolean {
		return this.options.readSession().readCompactionState().isCompacting;
	}

	readSteeringMode(): RuntimeSessionInputQueueMode {
		return this.options.readSession().readQueueModes().steering;
	}

	readFollowUpMode(): RuntimeSessionInputQueueMode {
		return this.options.readSession().readQueueModes().followUp;
	}

	readSessionName(): string | undefined {
		return this.options.readSession().readName();
	}

	readScopedModels(): readonly CodingAgentScopedModel[] {
		return [...this.scopedModels];
	}

	setScopedModels(scopedModels: readonly CodingAgentScopedModel[]): void {
		this.scopedModels = [...scopedModels];
	}

	clearQueue(): { readonly steering: readonly string[]; readonly followUp: readonly string[] } {
		return this.options.readSession().clearQueue();
	}

	readPendingMessageCount(): number {
		return this.options.readSession().readPendingMessageCount();
	}

	readSteeringMessages(): readonly string[] {
		return this.options.readSession().readQueuedMessages().steering;
	}

	readFollowUpMessages(): readonly string[] {
		return this.options.readSession().readQueuedMessages().followUp;
	}

	async selectModel(provider: string, modelId: string): Promise<Model<Api> | undefined> {
		return this.modelCapabilities.selectModel(provider, modelId);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.modelCapabilities.setThinkingLevel(level);
	}

	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<CodingAgentModelCycleResult | undefined> {
		return this.modelCapabilities.cycleModel(direction);
	}

	cycleThinkingLevel(): ThinkingLevel | undefined {
		return this.modelCapabilities.cycleThinkingLevel();
	}

	readAvailableThinkingLevels(): readonly ThinkingLevel[] {
		return this.modelCapabilities.readAvailableThinkingLevels();
	}

	supportsXhighThinking(): boolean {
		return this.modelCapabilities.supportsXhighThinking();
	}

	supportsThinking(): boolean {
		return this.modelCapabilities.supportsThinking();
	}

	setSteeringMode(mode: RuntimeSessionInputQueueMode): void {
		this.options.readSession().setSteeringMode(mode);
		this.options.settings?.setSteeringMode(mode);
	}

	setFollowUpMode(mode: RuntimeSessionInputQueueMode): void {
		this.options.readSession().setFollowUpMode(mode);
		this.options.settings?.setFollowUpMode(mode);
	}

	async compact(customInstructions?: string, signal?: AbortSignal) {
		const session = this.options.readSession();
		signal?.throwIfAborted();
		const abort = () => session.abortCompaction();
		signal?.addEventListener("abort", abort, { once: true });
		try {
			return await session.compact(customInstructions);
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	abortCompaction(): void {
		this.options.readSession().abortCompaction();
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		this.options.readSession().setAutoCompactionEnabled(enabled);
	}

	readAutoCompactionEnabled(): boolean {
		return this.options.readSession().readCompactionState().autoCompactionEnabled;
	}

	abortRetry(): void {
		this.retryController?.abortRetry();
	}

	readIsRetrying(): boolean {
		return this.retryController?.isRetrying ?? false;
	}

	readAutoRetryEnabled(): boolean {
		return this.options.settings?.getRetryEnabled() ?? false;
	}

	setAutoRetryEnabled(enabled: boolean): void {
		if (this.retryController) {
			this.retryController.setAutoRetryEnabled(enabled);
			return;
		}
		this.options.settings?.setRetryEnabled(enabled);
	}

	setSessionName(name: string): Promise<void> {
		return this.options.readSession().setName(name);
	}

	readSessionStats() {
		const session = this.options.readSession();
		return computeSdkSessionStats(
			projectCodingAgentMessages(session.readDocument()),
			session.sessionPath,
			session.sessionId,
		);
	}

	readContextUsage() {
		return this.options.readSession().readContextUsage();
	}

	readLastAssistantText(): string | undefined {
		const messages = projectCodingAgentMessages(this.options.readSession().readDocument());
		return readLastAssistantText(messages);
	}

	readSubagents() {
		const session = this.options.readSession();
		return session.hasExtension(CODING_AGENT_SUBAGENTS_READ)
			? session.invokeExtensionSync(CODING_AGENT_SUBAGENTS_READ, undefined).map((subagent) => ({
					...subagent,
					usage: { ...subagent.usage },
				}))
			: [];
	}

	interruptSubagent(target: string) {
		const session = this.options.readSession();
		return session.hasExtension(CODING_AGENT_SUBAGENT_INTERRUPT)
			? session.invokeExtensionSync(CODING_AGENT_SUBAGENT_INTERRUPT, { target })
			: undefined;
	}

	clearFinishedSubagents(): number {
		const session = this.options.readSession();
		return session.hasExtension(CODING_AGENT_SUBAGENTS_CLEAR_FINISHED)
			? session.invokeExtensionSync(CODING_AGENT_SUBAGENTS_CLEAR_FINISHED, undefined)
			: 0;
	}

	async readAvailableModels(): Promise<readonly Model<Api>[]> {
		return [...(await this.readAvailableModelSource())];
	}

	readSystemPrompt(): string {
		return this.options.readSystemPrompt?.() ?? "";
	}

	readSkills(): readonly CodingAgentSkillInfo[] {
		return (
			this.options.readSkills?.().map((skill) => ({
				...skill,
				// agentModes 已废弃（ADR-0071）：无消费者，仅为返回值不可变而拷贝容忍字段。
				agentModes: skill.agentModes ? [...skill.agentModes] : undefined,
			})) ?? []
		);
	}

	readPromptTemplates(): readonly CodingAgentPromptTemplate[] {
		return this.options.readPromptTemplates?.().map((template) => ({ ...template })) ?? [];
	}

	async reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void> {
		await this.options.reconfigureAgentPlugins?.(agentPlugins);
		const session = this.options.readSession();
		if (!session.hasExtension(CODING_AGENT_PLUGIN_CONFIGURATION_APPLY)) {
			throw new Error("Session Plugin configuration capability is unavailable");
		}
		await session.invokeExtension(CODING_AGENT_PLUGIN_CONFIGURATION_APPLY, { agentPlugins });
	}

	readBackgroundTasks() {
		const session = this.options.readSession();
		return session.hasExtension(CODING_AGENT_BACKGROUND_TASKS_READ)
			? session.invokeExtensionSync(CODING_AGENT_BACKGROUND_TASKS_READ, undefined).map((task) => ({ ...task }))
			: [];
	}

	killBackgroundTask(taskId: string): boolean {
		const session = this.options.readSession();
		return session.hasExtension(CODING_AGENT_BACKGROUND_TASK_KILL)
			? session.invokeExtensionSync(CODING_AGENT_BACKGROUND_TASK_KILL, { taskId })
			: false;
	}

	clearFinishedBackgroundTasks(): number {
		const session = this.options.readSession();
		if (!session.hasExtension(CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED)) {
			throw new Error("Session background task cleanup capability is unavailable");
		}
		return session.invokeExtensionSync(CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED, undefined);
	}

	readTodos() {
		const session = this.options.readSession();
		return session.hasExtension(CODING_AGENT_TODO_READ)
			? session.invokeExtensionSync(CODING_AGENT_TODO_READ, undefined).map((item) => ({ ...item }))
			: [];
	}

	clearTodos(): boolean {
		const session = this.options.readSession();
		return session.hasExtension(CODING_AGENT_TODO_CLEAR)
			? session.invokeExtensionSync(CODING_AGENT_TODO_CLEAR, undefined)
			: false;
	}

	readMemoryConfiguration(): CodingAgentMemoryConfiguration {
		return { ...(this.options.memoryConfiguration ?? { enabled: false, file: undefined, charLimit: 0 }) };
	}

	flushMemory(signal?: AbortSignal): Promise<number> {
		return this.options.flushMemory?.(signal) ?? Promise.resolve(0);
	}

	reloadMcp(): Promise<void> {
		if (!this.options.reloadMcp) throw new Error("Session MCP reload capability is unavailable");
		return this.options.reloadMcp();
	}

	reload(): Promise<void> {
		if (!this.options.reload) throw new Error("Session resource reload capability is unavailable");
		return this.options.reload();
	}

	exportToHtml(outputPath?: string): Promise<string> {
		if (!this.options.exportToHtml) throw new Error("Session HTML export capability is unavailable");
		return this.options.exportToHtml(outputPath);
	}

	hasExtensionHandlers(eventType: string): boolean {
		return this.options.hasExtensionHandlers?.(eventType) ?? false;
	}

	private readAvailableModelSource(): Promise<readonly Model<Api>[]> {
		return this.options.readAvailableModels?.() ?? Promise.resolve(this.options.readSession().readAvailableModels());
	}
}
