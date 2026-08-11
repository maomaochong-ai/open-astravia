import type { AgentMessage } from "@vetta/agent-core";
import type { ImageContent } from "@vetta/ai";
import type { MessageRenderer, RegisteredCommand } from "../api-contracts.js";
import type { ExtensionCommandContext, ExtensionContext, ExtensionModelCatalog } from "../context-contracts.js";
import type {
	InputEventResult,
	InputSource,
	ResourcesDiscoverEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	UserBashEvent,
	UserBashEventResult,
} from "../events/index.js";
import type { ExtensionKeybindingsConfig, ExtensionResourceDiagnostic, KeyId } from "../infrastructure.js";
import type { ExtensionExecutionHost } from "../runtime-bindings.js";
import type {
	Extension,
	ExtensionActions,
	ExtensionCommandContextActions,
	ExtensionContextActions,
	ExtensionError,
	ExtensionFlag,
	ExtensionRuntime,
	ExtensionShortcut,
	RegisteredTool,
} from "../runtime-contracts.js";
import type { ExtensionSessionView } from "../session-contracts.js";
import type {
	EcosystemPermissionHookRequest,
	EcosystemPermissionHookResult,
	ExtensionUIContext,
} from "../ui-contracts.js";
import { ExtensionContextHost } from "./context/extension-context-host.js";
import { AgentDispatcher, type BeforeAgentStartCombinedResult } from "./dispatcher/agent-dispatcher.js";
import { createDispatchEnvironment } from "./dispatcher/dispatch-environment.js";
import { LifecycleDispatcher, type RunnerEmitEvent, type RunnerEmitResult } from "./dispatcher/lifecycle-dispatcher.js";
import { ExtensionRegistry } from "./registry/extension-registry.js";

export type ExtensionErrorListener = (error: ExtensionError) => void;
export type NewSessionHandler = ExtensionCommandContextActions["newSession"];
export type ForkHandler = ExtensionCommandContextActions["fork"];
export type NavigateTreeHandler = ExtensionCommandContextActions["navigateTree"];
export type SwitchSessionHandler = ExtensionCommandContextActions["switchSession"];
export type ReloadHandler = ExtensionCommandContextActions["reload"];
export type ShutdownHandler = ExtensionContextActions["shutdown"];

export async function emitSessionShutdownEvent(extensionRunner: ExtensionRunner | undefined): Promise<boolean> {
	if (!extensionRunner?.hasHandlers("session_shutdown")) return false;
	await extensionRunner.emit({ type: "session_shutdown" });
	return true;
}

export class ExtensionRunner {
	private readonly errorListeners = new Set<ExtensionErrorListener>();
	private readonly contextHost: ExtensionContextHost;
	private readonly registry: ExtensionRegistry;
	private readonly lifecycleDispatcher: LifecycleDispatcher;
	private readonly agentDispatcher: AgentDispatcher;

	constructor(
		extensions: Extension[],
		private readonly runtime: ExtensionRuntime,
		cwd: string,
		sessionManager: ExtensionSessionView,
		modelCatalog: ExtensionModelCatalog,
	) {
		this.contextHost = new ExtensionContextHost(runtime, cwd, sessionManager, modelCatalog);
		this.registry = new ExtensionRegistry(extensions, () => this.contextHost.hasUI());
		const environment = createDispatchEnvironment(this.registry, this.contextHost, (error) => this.emitError(error));
		this.lifecycleDispatcher = new LifecycleDispatcher(environment);
		this.agentDispatcher = new AgentDispatcher(environment);
	}

	setEcosystemPermissionHandler(
		handler?: (request: EcosystemPermissionHookRequest) => Promise<EcosystemPermissionHookResult | undefined>,
	): void {
		this.contextHost.setEcosystemPermissionHandler(handler);
	}

	bindCore(actions: ExtensionActions, contextActions: ExtensionContextActions): void {
		this.contextHost.bindCore(actions, contextActions);
	}

	bindExecutionHost(host: ExtensionExecutionHost): void {
		this.contextHost.bindExecutionHost(host);
	}

	bindCommandContext(actions?: ExtensionCommandContextActions): void {
		this.contextHost.bindCommandContext(actions);
	}

	setUIContext(uiContext?: ExtensionUIContext): void {
		this.contextHost.setUIContext(uiContext);
	}

	getUIContext(): ExtensionUIContext {
		return this.contextHost.getUIContext();
	}

	hasUI(): boolean {
		return this.contextHost.hasUI();
	}

	getExtensionPaths(): string[] {
		return this.registry.getPaths();
	}

	getAllRegisteredTools(): RegisteredTool[] {
		return this.registry.getAllTools();
	}

	getToolDefinition(toolName: string): RegisteredTool["definition"] | undefined {
		return this.registry.getToolDefinition(toolName);
	}

	getFlags(): Map<string, ExtensionFlag> {
		return this.registry.getFlags();
	}

	setFlagValue(name: string, value: boolean | string): void {
		this.runtime.flagValues.set(name, value);
	}

	getFlagValues(): Map<string, boolean | string> {
		return new Map(this.runtime.flagValues);
	}

	getShortcuts(keybindings: ExtensionKeybindingsConfig): Map<KeyId, ExtensionShortcut> {
		return this.registry.getShortcuts(keybindings);
	}

	getShortcutDiagnostics(): ExtensionResourceDiagnostic[] {
		return this.registry.getShortcutDiagnostics();
	}

	onError(listener: ExtensionErrorListener): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	emitError(error: ExtensionError): void {
		for (const listener of this.errorListeners) listener(error);
	}

	hasHandlers(eventType: string): boolean {
		return this.registry.hasHandlers(eventType);
	}

	getMessageRenderer(customType: string): MessageRenderer | undefined {
		return this.registry.getMessageRenderer(customType);
	}

	getRegisteredCommands(reserved?: Set<string>): RegisteredCommand[] {
		return this.registry.getCommands(reserved);
	}

	getCommandDiagnostics(): ExtensionResourceDiagnostic[] {
		return this.registry.getCommandDiagnostics();
	}

	getRegisteredCommandsWithPaths(): Array<{ command: RegisteredCommand; extensionPath: string }> {
		return this.registry.getCommandsWithPaths();
	}

	getCommand(name: string): RegisteredCommand | undefined {
		return this.registry.getCommand(name);
	}

	shutdown(): void {
		this.contextHost.shutdown();
	}

	createContext(): ExtensionContext {
		return this.contextHost.createContext();
	}

	createCommandContext(): ExtensionCommandContext {
		return this.contextHost.createCommandContext();
	}

	emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
		return this.lifecycleDispatcher.emit(event);
	}

	emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
		return this.lifecycleDispatcher.emitToolResult(event);
	}

	emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		return this.lifecycleDispatcher.emitToolCall(event);
	}

	emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined> {
		return this.lifecycleDispatcher.emitUserBash(event);
	}

	emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		return this.agentDispatcher.emitContext(messages);
	}

	emitBeforeAgentStart(
		prompt: string,
		images: ImageContent[] | undefined,
		systemPrompt: string,
	): Promise<BeforeAgentStartCombinedResult | undefined> {
		return this.agentDispatcher.emitBeforeAgentStart(prompt, images, systemPrompt);
	}

	emitResourcesDiscover(
		cwd: string,
		reason: ResourcesDiscoverEvent["reason"],
	): ReturnType<AgentDispatcher["emitResourcesDiscover"]> {
		return this.agentDispatcher.emitResourcesDiscover(cwd, reason);
	}

	emitInput(text: string, images: ImageContent[] | undefined, source: InputSource): Promise<InputEventResult> {
		return this.agentDispatcher.emitInput(text, images, source);
	}
}
