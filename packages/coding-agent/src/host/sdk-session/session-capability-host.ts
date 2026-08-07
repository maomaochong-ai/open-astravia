import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type {
	AgentPluginRuntimeConfig,
	GreenfieldRuntimeSession,
	PromptRequest,
	RuntimeSessionInputQueueMode,
} from "@vetta/runtime-core";
import { projectCodingAgentGreenfieldMessages } from "../../adapters/runtime-core/greenfield-agent-message-context-projector.js";
import type { CodingAgentTurnRetryController } from "../session-execution/contracts.js";
import { readCodingAgentFailedTurnMessage } from "../session-execution/turn-executor.js";
import { createCodingAgentTurnRetryController } from "../session-execution/turn-retry-controller.js";
import type {
	GreenfieldSdkCustomToolDefinition,
	GreenfieldSdkMemoryConfiguration,
	GreenfieldSdkModelCycleResult,
	GreenfieldSdkPromptTemplate,
	GreenfieldSdkRetryEvent,
	GreenfieldSdkScopedModel,
	GreenfieldSdkSessionCapabilityPort,
	GreenfieldSdkSkillInfo,
	GreenfieldSdkToolInfo,
} from "./runtime-contracts.js";
import type { CodingAgentGreenfieldSessionCapabilityHostOptions } from "./session-capability-options.js";
import { computeSdkSessionStats, readLastAssistantText, toSdkToolInfo } from "./session-capability-projections.js";
import { CodingAgentSessionModelCapabilities } from "./session-model-capabilities.js";

export type {
	CodingAgentGreenfieldSessionCapabilityHostOptions,
	CodingAgentGreenfieldSessionCapabilitySettings,
} from "./session-capability-options.js";

/** SDK 与 RPC 共用的 Session 内操作能力；不拥有 Session，也不执行身份迁移。 */
export class CodingAgentGreenfieldSessionCapabilityHost implements GreenfieldSdkSessionCapabilityPort {
	private scopedModels: GreenfieldSdkScopedModel[];
	private agentMode: string | undefined;
	private readonly retryController: CodingAgentTurnRetryController | undefined;
	private readonly retryListeners = new Set<(event: GreenfieldSdkRetryEvent) => void>();
	private readonly modelCapabilities: CodingAgentSessionModelCapabilities;

	constructor(private readonly options: CodingAgentGreenfieldSessionCapabilityHostOptions) {
		this.scopedModels = [...(options.scopedModels ?? [])];
		this.agentMode = options.initialAgentMode;
		this.modelCapabilities = new CodingAgentSessionModelCapabilities({
			readCore: () => this.readCore(),
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
					readCodingAgentFailedTurnMessage,
				)
			: await executeInitial();
		const failure = readCodingAgentFailedTurnMessage(result);
		if (failure) throw new Error(failure);
		return result;
	}

	subscribeRetryEvents(handler: (event: GreenfieldSdkRetryEvent) => void): () => void {
		this.retryListeners.add(handler);
		return () => this.retryListeners.delete(handler);
	}

	readRetryAttempt(): number {
		return this.retryController?.retryAttempt ?? 0;
	}

	readActiveToolNames(): readonly string[] {
		return this.readCore().toolController?.readActiveToolNames() ?? [];
	}

	readAllTools(): readonly GreenfieldSdkToolInfo[] {
		const tools = this.readCore().toolController?.readAvailableTools();
		return tools ? toSdkToolInfo(tools) : [];
	}

	setActiveToolNames(toolNames: readonly string[]): void {
		const controller = this.readCore().toolController;
		if (!controller) throw new Error("Greenfield session tool capability is unavailable");
		controller.setActiveToolNames(toolNames);
	}

	reconfigureCustomTools(customTools: readonly GreenfieldSdkCustomToolDefinition[] | undefined): void {
		if (!this.options.reconfigureCustomTools) {
			throw new Error("Greenfield session custom tool capability is unavailable");
		}
		this.options.reconfigureCustomTools(customTools);
	}

	readAgentMode(): string | undefined {
		return this.agentMode;
	}

	setAgentMode(mode: string | undefined): void {
		this.readConfigurationController().setAgentMode(mode);
		this.agentMode = mode;
	}

	readIsCompacting(): boolean {
		return this.readContextController().readState().isCompacting;
	}

	readSteeringMode(): RuntimeSessionInputQueueMode {
		return this.readCore().queueController.readSteeringMode();
	}

	readFollowUpMode(): RuntimeSessionInputQueueMode {
		return this.readCore().queueController.readFollowUpMode();
	}

	readSessionName(): string | undefined {
		return this.readCore().metadataController.readName();
	}

	readScopedModels(): readonly GreenfieldSdkScopedModel[] {
		return [...this.scopedModels];
	}

	setScopedModels(scopedModels: readonly GreenfieldSdkScopedModel[]): void {
		this.scopedModels = [...scopedModels];
	}

	clearQueue(): { readonly steering: readonly string[]; readonly followUp: readonly string[] } {
		return this.readCore().queueController.clear();
	}

	readPendingMessageCount(): number {
		return this.readCore().queueController.readPendingMessageCount();
	}

	readSteeringMessages(): readonly string[] {
		return this.readCore().queueController.readSteeringMessages();
	}

	readFollowUpMessages(): readonly string[] {
		return this.readCore().queueController.readFollowUpMessages();
	}

	async selectModel(provider: string, modelId: string): Promise<Model<Api> | undefined> {
		return this.modelCapabilities.selectModel(provider, modelId);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.modelCapabilities.setThinkingLevel(level);
	}

	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<GreenfieldSdkModelCycleResult | undefined> {
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
		this.readConfigurationController().setSteeringMode(mode);
		this.options.settings?.setSteeringMode(mode);
	}

	setFollowUpMode(mode: RuntimeSessionInputQueueMode): void {
		this.readConfigurationController().setFollowUpMode(mode);
		this.options.settings?.setFollowUpMode(mode);
	}

	async compact(customInstructions?: string, signal?: AbortSignal) {
		const controller = this.readContextController();
		signal?.throwIfAborted();
		const abort = () => controller.abortCompaction();
		signal?.addEventListener("abort", abort, { once: true });
		try {
			return await controller.compact(customInstructions ? { customInstructions } : undefined);
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	abortCompaction(): void {
		this.readContextController().abortCompaction();
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		this.readContextController().setAutoCompactionEnabled(enabled);
	}

	readAutoCompactionEnabled(): boolean {
		return this.readContextController().readState().autoCompactionEnabled;
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
		return this.readCore().metadataController.setName(name);
	}

	readSessionStats() {
		const core = this.readCore();
		return computeSdkSessionStats(
			projectCodingAgentGreenfieldMessages(core.conversationView.readDocument()),
			core.lifecycle.sessionPath,
			core.lifecycle.sessionId,
		);
	}

	readContextUsage() {
		return this.readCore().contextUsageView.readContextUsage();
	}

	readLastAssistantText(): string | undefined {
		const messages = projectCodingAgentGreenfieldMessages(this.readCore().conversationView.readDocument());
		return readLastAssistantText(messages);
	}

	readSubagents() {
		return this.readBackgroundWorkController()?.readSubagents() ?? [];
	}

	interruptSubagent(target: string) {
		return this.readBackgroundWorkController()?.interruptSubagent(target);
	}

	clearFinishedSubagents(): number {
		return this.readBackgroundWorkController()?.clearFinishedSubagents?.() ?? 0;
	}

	async readAvailableModels(): Promise<readonly Model<Api>[]> {
		return [...(await this.readAvailableModelSource())];
	}

	readSystemPrompt(): string {
		return this.options.readSystemPrompt?.() ?? "";
	}

	readSkills(): readonly GreenfieldSdkSkillInfo[] {
		return (
			this.options.readSkills?.().map((skill) => ({
				...skill,
				agentModes: skill.agentModes ? [...skill.agentModes] : undefined,
			})) ?? []
		);
	}

	readPromptTemplates(): readonly GreenfieldSdkPromptTemplate[] {
		return this.options.readPromptTemplates?.().map((template) => ({ ...template })) ?? [];
	}

	async reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void> {
		await this.options.reconfigureAgentPlugins?.(agentPlugins);
		await this.readConfigurationController().reconfigureAgentPlugins(agentPlugins);
	}

	readBackgroundTasks() {
		return (
			this.readBackgroundWorkController()
				?.readTasks()
				.map((task) => ({ ...task })) ?? []
		);
	}

	killBackgroundTask(taskId: string): boolean {
		return this.readBackgroundWorkController()?.killTask(taskId) ?? false;
	}

	clearFinishedBackgroundTasks(): number {
		const controller = this.readBackgroundWorkController();
		if (!controller?.clearFinishedTasks) {
			throw new Error("Greenfield session background task cleanup capability is unavailable");
		}
		return controller.clearFinishedTasks();
	}

	readTodos() {
		return (
			this.readCore()
				.todoController?.readItems()
				.map((item) => ({ ...item })) ?? []
		);
	}

	clearTodos(): boolean {
		return this.readCore().todoController?.clear() ?? false;
	}

	readMemoryConfiguration(): GreenfieldSdkMemoryConfiguration {
		return { ...(this.options.memoryConfiguration ?? { enabled: false, file: undefined, charLimit: 0 }) };
	}

	flushMemory(signal?: AbortSignal): Promise<number> {
		return this.options.flushMemory?.(signal) ?? Promise.resolve(0);
	}

	reloadMcp(): Promise<void> {
		if (!this.options.reloadMcp) throw new Error("Greenfield session MCP reload capability is unavailable");
		return this.options.reloadMcp();
	}

	reload(): Promise<void> {
		if (!this.options.reload) throw new Error("Greenfield session resource reload capability is unavailable");
		return this.options.reload();
	}

	exportToHtml(outputPath?: string): Promise<string> {
		if (!this.options.exportToHtml) throw new Error("Greenfield session HTML export capability is unavailable");
		return this.options.exportToHtml(outputPath);
	}

	hasExtensionHandlers(eventType: string): boolean {
		return this.options.hasExtensionHandlers?.(eventType) ?? false;
	}

	private readCore(): ReturnType<GreenfieldRuntimeSession["createCoreAssembly"]> {
		return this.options.readSession().createCoreAssembly();
	}

	private readConfigurationController() {
		const controller = this.options.readSession().createRuntimeHostAssemblyCandidate().configurationController;
		if (!controller) throw new Error("Greenfield session configuration capability is unavailable");
		return controller;
	}

	private readContextController() {
		const controller = this.readCore().contextController;
		if (!controller) throw new Error("Greenfield session context capability is unavailable");
		return controller;
	}

	private readBackgroundWorkController() {
		return this.options.readSession().createRuntimeHostAssemblyCandidate().backgroundWorkController;
	}

	private readAvailableModelSource(): Promise<readonly Model<Api>[]> {
		return this.options.readAvailableModels?.() ?? Promise.resolve(this.readCore().modelView.readAvailableModels());
	}
}
