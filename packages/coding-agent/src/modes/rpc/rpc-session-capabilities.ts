import type { AgentMessage, ThinkingLevel } from "@vetta/agent-core";
import type { Api, ImageContent, Model } from "@vetta/ai";
import type { CompactionResult } from "../../compaction/index.js";
import type { ExtensionUIContext, ExtensionUIDialogOptions, ExtensionWidgetOptions } from "../../extensions/index.js";
import type { RpcBashResult, RpcCommandType, RpcSessionState, RpcSlashCommand, SessionStats } from "./rpc-types.js";

/** Stable external identifiers retained for RPC consumers; they do not select an execution backend. */
export type RpcSessionProfileId = "greenfield" | "greenfield-im";

export interface RpcSessionProfile {
	readonly id: RpcSessionProfileId;
	readonly commands: "all" | readonly RpcCommandType[];
	readonly hostBridge: "optional" | "required";
}

export const RPC_IM_SESSION_PROFILE: RpcSessionProfile = Object.freeze({
	id: "greenfield-im",
	commands: Object.freeze([
		"prompt",
		"abort",
		"new_session",
		"get_state",
		"flush_memory",
		"switch_session",
		"fork",
		"get_fork_messages",
		"get_commands",
	] as const),
	hostBridge: "required",
});

export const RPC_FULL_SESSION_PROFILE: RpcSessionProfile = Object.freeze({
	id: "greenfield",
	commands: "all",
	hostBridge: "optional",
});

export interface RpcSessionExtensionError {
	readonly extensionPath: string;
	readonly event: string;
	readonly error: string;
}

/** Host protocol used by the RPC-only attachment tool. */
export interface ImHostBridge {
	sendAttachment(params: {
		readonly path: string;
		readonly kind: "image" | "file";
		readonly caption?: string;
	}): Promise<{ readonly messageId?: string }>;
}

export interface RpcSessionInitialization {
	readonly uiContext: ExtensionUIContext;
	readonly hostBridge?: ImHostBridge;
	readonly onShutdownRequested: () => void;
	readonly onExtensionError: (error: RpcSessionExtensionError) => void;
}

export interface RpcTurnCapability {
	prompt(
		message: string,
		options: {
			readonly images?: ImageContent[];
			readonly streamingBehavior?: "steer" | "followUp";
			readonly source: "rpc";
		},
	): Promise<void>;
	steer(message: string, images?: ImageContent[]): Promise<void>;
	followUp(message: string, images?: ImageContent[]): Promise<void>;
	abort(): Promise<void>;
}

export interface RpcStateCapability {
	readState(): Promise<RpcSessionState>;
	readMessages(): readonly AgentMessage[];
}

export interface RpcModelCapability {
	selectModel(provider: string, modelId: string): Promise<Model<Api> | undefined>;
	cycleModel(): Promise<{ model: Model<Api>; thinkingLevel: ThinkingLevel; isScoped: boolean } | undefined>;
	readAvailableModels(): Promise<readonly (Model<Api> & { readonly remote?: boolean })[]>;
	setThinkingLevel(level: ThinkingLevel): void;
	cycleThinkingLevel(): ThinkingLevel | undefined;
}

export interface RpcQueueCapability {
	setSteeringMode(mode: "all" | "one-at-a-time"): void;
	setFollowUpMode(mode: "all" | "one-at-a-time"): void;
}

export interface RpcContextCapability {
	compact(customInstructions?: string, signal?: AbortSignal): Promise<CompactionResult>;
	setAutoCompactionEnabled(enabled: boolean): void;
}

export interface RpcMemoryCapability {
	flushMemory(signal?: AbortSignal): Promise<number>;
}

export interface RpcRetryCapability {
	setAutoRetryEnabled(enabled: boolean): void;
	abortRetry(): void;
}

export interface RpcBashCapability {
	execute(command: string, signal?: AbortSignal): Promise<RpcBashResult>;
	abort(): void;
}

export interface RpcSessionManagementCapability {
	newSession(parentSession?: string): Promise<boolean>;
	switchSession(sessionPath: string): Promise<boolean>;
	fork(entryId: string): Promise<{ text: string; cancelled: boolean }>;
	readForkMessages(): readonly { entryId: string; text: string }[];
	readLastAssistantText(): string | undefined;
	setName(name: string): void | Promise<void>;
	readStats(): SessionStats;
	exportHtml(outputPath?: string): Promise<string>;
}

export interface RpcCommandDiscoveryCapability {
	readCommands(): readonly RpcSlashCommand[];
}

export interface RpcSessionCapabilities {
	readonly profile: RpcSessionProfile;
	readonly turn?: RpcTurnCapability;
	readonly state?: RpcStateCapability;
	readonly model?: RpcModelCapability;
	readonly queue?: RpcQueueCapability;
	readonly context?: RpcContextCapability;
	readonly memory?: RpcMemoryCapability;
	readonly retry?: RpcRetryCapability;
	readonly bash?: RpcBashCapability;
	readonly session?: RpcSessionManagementCapability;
	readonly commands?: RpcCommandDiscoveryCapability;
	initialize(input: RpcSessionInitialization): Promise<void>;
	subscribe(listener: (event: unknown) => void): () => void;
	shutdown(): Promise<void>;
	dispose(): Promise<void>;
}

export function supportsRpcCommand(profile: RpcSessionProfile, command: RpcCommandType): boolean {
	return profile.commands === "all" || profile.commands.includes(command);
}

export function assertRpcSessionCapabilities(
	session: RpcSessionCapabilities,
	options: { readonly hostBridgeEnabled: boolean },
): void {
	if (session.profile.hostBridge === "required" && !options.hostBridgeEnabled) {
		throw new Error(`RPC profile ${session.profile.id} requires the host bridge`);
	}
	for (const command of Object.keys(RPC_COMMAND_CAPABILITIES) as RpcCommandType[]) {
		const capability = RPC_COMMAND_CAPABILITIES[command];
		if (supportsRpcCommand(session.profile, command) && !session[capability]) {
			throw new Error(`RPC profile ${session.profile.id} requires capability ${capability} for command ${command}`);
		}
	}
}

type RpcCapabilityGroup = Exclude<
	keyof RpcSessionCapabilities,
	"profile" | "initialize" | "subscribe" | "shutdown" | "dispose"
>;

const RPC_COMMAND_CAPABILITIES = {
	prompt: "turn",
	steer: "turn",
	follow_up: "turn",
	abort: "turn",
	new_session: "session",
	get_state: "state",
	set_model: "model",
	cycle_model: "model",
	get_available_models: "model",
	set_thinking_level: "model",
	cycle_thinking_level: "model",
	set_steering_mode: "queue",
	set_follow_up_mode: "queue",
	compact: "context",
	set_auto_compaction: "context",
	flush_memory: "memory",
	set_auto_retry: "retry",
	abort_retry: "retry",
	bash: "bash",
	abort_bash: "bash",
	get_session_stats: "session",
	export_html: "session",
	switch_session: "session",
	fork: "session",
	get_fork_messages: "session",
	get_last_assistant_text: "session",
	set_session_name: "session",
	get_messages: "state",
	get_commands: "commands",
} as const satisfies Record<RpcCommandType, RpcCapabilityGroup>;

export type { ExtensionUIContext, ExtensionUIDialogOptions, ExtensionWidgetOptions };
