import type { CodingAgentHostBootstrap } from "@vetta/coding-agent/bootstrap";
import type {
	CodingAgentActiveSessionHost as CodingAgentGreenfieldActiveSessionHost,
	CodingAgentRuntimeComposition as GreenfieldRuntimeComposition,
} from "@vetta/coding-agent/composition";
import { type CodingAgentHtmlExportRuntime, createCodingAgentHtmlExportRuntime } from "@vetta/coding-agent/export-html";
import {
	exportGreenfieldRpcConversation,
	type GreenfieldRpcRetryEvent,
	type RpcRuntimeDecision,
	type RpcSessionCapabilities,
	type RpcSessionInitialization,
	type RpcSessionProfile,
	type RpcSessionState,
	readGreenfieldRpcAgentMessages,
} from "@vetta/coding-agent/rpc";
import {
	type CodingAgentRuntimeExtensionCommandHost,
	type CodingAgentSessionCapabilityHost,
	type CodingAgentTurnExecutor,
	type CodingAgentTurnRetryController,
	createCodingAgentSessionCapabilityHost,
} from "@vetta/coding-agent/runtime";
import { type GreenfieldRuntimeSession, type HistoryEntry, RetryableCleanup } from "@vetta/runtime-core";
import { type CodingToolRegistration, createImSendAttachmentToolRegistration } from "@vetta/runtime-tools/coding";
import { GreenfieldRpcEventAdapter } from "./greenfield-rpc-events.js";

type GreenfieldResourceLoader = Pick<CodingAgentHostBootstrap["resourceLoader"], "getPrompts" | "getSkills">;
type GreenfieldCommandDiscoveryCapability = NonNullable<RpcSessionCapabilities["commands"]>;

interface ActiveTurnCommand {
	readonly terminalDeliveries: Array<() => void>;
}

export interface GreenfieldRpcSessionAdapterOptions {
	readonly profile: RpcSessionProfile;
	readonly runtimeBackend: "greenfield" | "greenfield-im";
	readonly sessionHost: Pick<
		CodingAgentGreenfieldActiveSessionHost,
		"dispose" | "fork" | "newSession" | "readSession" | "startActiveSessionOperation" | "subscribe" | "switchSession"
	>;
	readonly runtime: GreenfieldRuntimeComposition;
	readonly resourceLoader: GreenfieldResourceLoader;
	readonly runtimeDecision?: RpcRuntimeDecision;
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
	readonly retryController?: CodingAgentTurnRetryController;
	readonly turnExecutor?: Pick<CodingAgentTurnExecutor, "prompt">;
	readonly disposeSessionResources?: boolean;
	readonly bash?: RpcSessionCapabilities["bash"];
	readonly readAvailableModels?: NonNullable<RpcSessionCapabilities["model"]>["readAvailableModels"];
	readonly extensionCommandHost?: Pick<
		CodingAgentRuntimeExtensionCommandHost,
		"readCommands" | "throwIfExtensionCommand" | "tryExecute"
	>;
	readonly createHostToolRegistration?: (
		hostBridge: NonNullable<RpcSessionInitialization["hostBridge"]>,
	) => CodingToolRegistration;
}

/** Greenfield Runtime 到 RPC capability 合同的中性产品宿主适配器。 */
export class GreenfieldRpcSessionAdapter implements RpcSessionCapabilities {
	readonly profile;
	readonly turn;
	readonly state;
	readonly model;
	readonly queue;
	readonly context;
	readonly memory;
	readonly retry;
	readonly bash: RpcSessionCapabilities["bash"];
	readonly session;
	readonly commands: GreenfieldCommandDiscoveryCapability;

	private readonly sessionHost: GreenfieldRpcSessionAdapterOptions["sessionHost"];
	private readonly runtime: GreenfieldRuntimeComposition;
	private readonly resourceLoader: GreenfieldResourceLoader;
	private readonly runtimeBackend: GreenfieldRpcSessionAdapterOptions["runtimeBackend"];
	private readonly runtimeDecision: RpcRuntimeDecision;
	private readonly htmlExporter: CodingAgentHtmlExportRuntime;
	private readonly retryController: CodingAgentTurnRetryController | undefined;
	private readonly turnExecutor: GreenfieldRpcSessionAdapterOptions["turnExecutor"];
	private readonly readAvailableModels: NonNullable<GreenfieldRpcSessionAdapterOptions["readAvailableModels"]>;
	private readonly sessionCapabilities: CodingAgentSessionCapabilityHost;
	private readonly extensionCommandHost: GreenfieldRpcSessionAdapterOptions["extensionCommandHost"];
	private readonly createHostToolRegistration: NonNullable<
		GreenfieldRpcSessionAdapterOptions["createHostToolRegistration"]
	>;
	private unregisterHostTool: (() => void) | undefined;
	private initialized = false;
	private readonly activeTurnCommands: ActiveTurnCommand[] = [];
	private readonly supplementalListeners = new Set<(event: unknown) => void>();
	private readonly cleanup = new RetryableCleanup();

	constructor(options: GreenfieldRpcSessionAdapterOptions) {
		this.profile = options.profile;
		this.runtimeBackend = options.runtimeBackend;
		this.sessionHost = options.sessionHost;
		this.runtime = options.runtime;
		this.resourceLoader = options.resourceLoader;
		this.runtimeDecision = options.runtimeDecision ?? {
			requestedBackend: options.runtimeBackend,
			effectiveBackend: options.runtimeBackend,
		};
		this.htmlExporter = options.htmlExporter ?? createCodingAgentHtmlExportRuntime();
		this.retryController = options.retryController;
		this.turnExecutor = options.turnExecutor;
		this.retry = options.retryController;
		this.bash = options.bash;
		this.readAvailableModels =
			options.readAvailableModels ?? (async () => this.readCore().modelView.readAvailableModels());
		this.sessionCapabilities = createCodingAgentSessionCapabilityHost({
			readSession: () => this.readSession(),
			readAvailableModels: this.readAvailableModels,
			retryController: options.retryController,
		});
		this.extensionCommandHost = options.extensionCommandHost;
		this.createHostToolRegistration =
			options.createHostToolRegistration ??
			((hostBridge) => createImSendAttachmentToolRegistration({ sender: hostBridge }));
		this.cleanup.add({
			id: "host-tool",
			phase: 0,
			cleanup: () => {
				const unregister = this.unregisterHostTool;
				if (!unregister) return;
				unregister();
				if (this.unregisterHostTool === unregister) this.unregisterHostTool = undefined;
			},
		});
		if (options.disposeSessionResources !== false) {
			this.cleanup.add({ id: "session-host", phase: 1, cleanup: () => this.sessionHost.dispose() });
			this.cleanup.add({ id: "runtime", phase: 2, cleanup: () => this.runtime.dispose() });
		}
		this.turn = {
			prompt: async (message, promptOptions) => {
				const turnExecutor = this.turnExecutor;
				if (turnExecutor) {
					await this.runTurnCommand(() =>
						turnExecutor.prompt(message, {
							images: promptOptions.images,
							streamingBehavior: promptOptions.streamingBehavior,
						}),
					);
					return;
				}
				if (
					this.extensionCommandHost &&
					(await this.sessionHost.startActiveSessionOperation(() =>
						this.extensionCommandHost!.tryExecute(message),
					))
				) {
					return;
				}
				await this.runTurnCommand(() =>
					this.sessionHost.startActiveSessionOperation((session) =>
						session.prompt({
							text: message,
							images: promptOptions.images,
							streamingBehavior: promptOptions.streamingBehavior,
						}),
					),
				);
			},
			steer: async (message, images) => {
				const turnExecutor = this.turnExecutor;
				if (turnExecutor) {
					await this.runTurnCommand(() => turnExecutor.prompt(message, { images, streamingBehavior: "steer" }));
					return;
				}
				this.extensionCommandHost?.throwIfExtensionCommand(message);
				await this.runTurnCommand(() =>
					this.sessionHost.startActiveSessionOperation((session) =>
						session.prompt({ text: message, images, streamingBehavior: "steer" }),
					),
				);
			},
			followUp: async (message, images) => {
				const turnExecutor = this.turnExecutor;
				if (turnExecutor) {
					await this.runTurnCommand(() => turnExecutor.prompt(message, { images, streamingBehavior: "followUp" }));
					return;
				}
				this.extensionCommandHost?.throwIfExtensionCommand(message);
				await this.runTurnCommand(() =>
					this.sessionHost.startActiveSessionOperation((session) =>
						session.prompt({ text: message, images, streamingBehavior: "followUp" }),
					),
				);
			},
			abort: () => this.readSession().abort("RPC abort"),
		} satisfies NonNullable<RpcSessionCapabilities["turn"]>;
		this.state = {
			readState: () => this.readRpcState(),
			readMessages: () => readGreenfieldRpcAgentMessages(this.readCore().conversationView.readDocument()),
		} satisfies NonNullable<RpcSessionCapabilities["state"]>;
		this.model = {
			selectModel: (provider, modelId) => this.sessionCapabilities.selectModel(provider, modelId),
			cycleModel: () => this.sessionCapabilities.cycleModel(),
			readAvailableModels: this.readAvailableModels,
			setThinkingLevel: (level) => this.sessionCapabilities.setThinkingLevel(level),
			cycleThinkingLevel: () => this.sessionCapabilities.cycleThinkingLevel(),
		} satisfies NonNullable<RpcSessionCapabilities["model"]>;
		this.queue = {
			setSteeringMode: (mode) => this.sessionCapabilities.setSteeringMode(mode),
			setFollowUpMode: (mode) => this.sessionCapabilities.setFollowUpMode(mode),
		} satisfies NonNullable<RpcSessionCapabilities["queue"]>;
		this.context = {
			compact: (customInstructions, signal) => this.sessionCapabilities.compact(customInstructions, signal),
			setAutoCompactionEnabled: (enabled) => this.sessionCapabilities.setAutoCompactionEnabled(enabled),
		} satisfies NonNullable<RpcSessionCapabilities["context"]>;
		this.memory = {
			flushMemory: (signal?: AbortSignal) =>
				signal
					? this.runtime.flushMemory(this.readSession().sessionId, signal)
					: this.runtime.flushMemory(this.readSession().sessionId),
		} satisfies NonNullable<RpcSessionCapabilities["memory"]>;
		this.session = {
			newSession: async (parentSession) =>
				!(await this.sessionHost.newSession(parentSession ? { parentSession } : undefined)).cancelled,
			switchSession: async (sessionPath) => !(await this.sessionHost.switchSession(sessionPath)).cancelled,
			fork: (entryId) => this.sessionHost.fork(entryId),
			readForkMessages: () => readForkMessages(this.readSession()),
			readLastAssistantText: () => this.sessionCapabilities.readLastAssistantText(),
			setName: (name) => this.sessionCapabilities.setSessionName(name),
			readStats: () => this.sessionCapabilities.readSessionStats(),
			exportHtml: (outputPath) => {
				const core = this.readCore();
				if (!core.lifecycle.sessionPath) throw new Error("Cannot export an in-memory Greenfield session");
				return exportGreenfieldRpcConversation(
					this.htmlExporter,
					core.conversationView.readDocument(),
					core.lifecycle.sessionPath,
					outputPath,
				);
			},
		} satisfies NonNullable<RpcSessionCapabilities["session"]>;
		this.commands = {
			readCommands: () => [
				...(this.extensionCommandHost?.readCommands() ?? []),
				...readResourceCommands(this.resourceLoader),
			],
		};
	}

	async initialize(input: RpcSessionInitialization): Promise<void> {
		if (this.initialized) throw new Error(`RPC profile ${this.profile.id} is already initialized`);
		if (!input.hostBridge && this.profile.hostBridge === "required") {
			throw new Error(`RPC profile ${this.profile.id} requires a host bridge`);
		}
		this.initialized = true;
		if (!input.hostBridge) return;
		const registration = this.createHostToolRegistration(input.hostBridge);
		this.runtime.tools.registry.register(registration);
		this.unregisterHostTool = () => this.runtime.tools.registry.unregister(registration.tool.name);
	}

	subscribe(listener: (event: unknown) => void): () => void {
		const adapter = new GreenfieldRpcEventAdapter();
		let subscribed = true;
		this.supplementalListeners.add(listener);
		const unsubscribe = this.sessionHost.subscribe((event) => {
			for (const mapped of adapter.map(event)) {
				const activeTurn = this.activeTurnCommands[0];
				if (isAgentEndFrame(mapped) && activeTurn) {
					activeTurn.terminalDeliveries.push(() => {
						if (subscribed) listener(mapped);
					});
					continue;
				}
				listener(mapped);
			}
		});
		return () => {
			subscribed = false;
			this.supplementalListeners.delete(listener);
			unsubscribe();
		};
	}

	async shutdown(): Promise<void> {}

	async dispose(): Promise<void> {
		this.retryController?.abortRetry();
		this.supplementalListeners.clear();
		try {
			await this.cleanup.run("Failed to dispose Greenfield RPC resources");
		} catch (error) {
			throw new AggregateError(
				error instanceof AggregateError ? error.errors : [error],
				"Failed to dispose Greenfield RPC resources",
			);
		}
	}

	emitSupplementalEvent(event: GreenfieldRpcRetryEvent): void {
		for (const listener of this.supplementalListeners) listener(event);
	}

	private async readRpcState(): Promise<RpcSessionState> {
		const greenfieldSession = this.readSession();
		const core = greenfieldSession.createCoreAssembly();
		const [sessionState, state] = await Promise.all([
			greenfieldSession.getState(),
			Promise.resolve(core.corePorts.stateReader.readState()),
		]);
		const context = core.contextController?.readState();
		return {
			runtimeBackend: this.runtimeBackend,
			runtimeDecision: this.runtimeDecision,
			model: state.model,
			thinkingLevel: state.thinkingLevel,
			isStreaming: state.isStreaming,
			isCompacting: context?.isCompacting ?? false,
			steeringMode: sessionState.steeringMode,
			followUpMode: sessionState.followUpMode,
			sessionFile: core.lifecycle.sessionPath,
			sessionId: sessionState.sessionId,
			sessionName: core.metadataController?.readName(),
			autoCompactionEnabled: context?.autoCompactionEnabled ?? false,
			messageCount: sessionState.messageCount,
			pendingMessageCount: sessionState.pendingMessageCount,
		};
	}

	private readSession(): GreenfieldRuntimeSession {
		return this.sessionHost.readSession();
	}

	private readCore(): ReturnType<GreenfieldRuntimeSession["createCoreAssembly"]> {
		return this.readSession().createCoreAssembly();
	}

	private async runTurnCommand(command: () => Promise<unknown>): Promise<void> {
		const activeTurn: ActiveTurnCommand = { terminalDeliveries: [] };
		this.activeTurnCommands.push(activeTurn);
		let result: unknown;
		let rejection: { readonly error: unknown } | undefined;
		try {
			result = this.turnExecutor
				? await command()
				: this.retryController
					? await this.retryController.run(
							command,
							() => this.sessionHost.startActiveSessionOperation((session) => session.continue()),
							readFailedTurnMessage,
						)
					: await command();
		} catch (error) {
			rejection = { error };
		} finally {
			const activeIndex = this.activeTurnCommands.indexOf(activeTurn);
			if (activeIndex >= 0) this.activeTurnCommands.splice(activeIndex, 1);
			for (const deliver of activeTurn.terminalDeliveries) deliver();
		}
		if (activeTurn.terminalDeliveries.length > 0) return;
		if (rejection) throw rejection.error;
		const failedMessage = readFailedTurnMessage(result);
		if (failedMessage) throw new Error(failedMessage);
	}
}

function readFailedTurnMessage(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const error = Reflect.get(value, "error");
	return Reflect.get(value, "status") === "failed" &&
		typeof error === "object" &&
		error !== null &&
		typeof Reflect.get(error, "message") === "string"
		? Reflect.get(error, "message")
		: undefined;
}

function isAgentEndFrame(event: unknown): boolean {
	return typeof event === "object" && event !== null && Reflect.get(event, "type") === "agent_end";
}

function readResourceCommands(
	resourceLoader: GreenfieldResourceLoader,
): ReturnType<GreenfieldCommandDiscoveryCapability["readCommands"]> {
	const prompts = resourceLoader.getPrompts().prompts.map((template) => ({
		name: template.name,
		description: template.description,
		source: "prompt" as const,
		location: normalizeLocation(template.source),
		path: template.filePath,
	}));
	const skills = resourceLoader.getSkills().skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill" as const,
		location: normalizeLocation(skill.source),
		path: skill.filePath,
	}));
	return [...prompts, ...skills];
}

function normalizeLocation(source: string): "user" | "project" | "path" | undefined {
	return source === "user" || source === "project" || source === "path" ? source : undefined;
}

function readForkMessages(session: GreenfieldRuntimeSession): readonly { entryId: string; text: string }[] {
	return session
		.readHistory()
		.filter(
			(entry): entry is Extract<HistoryEntry, { type: "message" }> =>
				entry.type === "message" && entry.message.role === "user" && entry.entryId !== undefined,
		)
		.map((entry) => ({ entryId: entry.entryId ?? "", text: readMessageText(entry.message) }))
		.filter(({ text }) => text.length > 0);
}

function readMessageText(message: { readonly content: unknown }): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.map((part) =>
			typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "",
		)
		.join("");
}
