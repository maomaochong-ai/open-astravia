import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import type {
	ExtensionCommandContextActions,
	ExtensionError,
	ExtensionRunner,
	ExtensionSessionSetup,
	ExtensionUIContext,
	SlashCommandInfo,
} from "../../extensions/index.js";
import type {
	CodingAgentNewSessionOptions,
	CodingAgentPreparedSessionBinding,
	CodingAgentSessionSeedInitializer,
	CodingAgentSessionTransition,
} from "../session-transition/contracts.js";

export interface CodingAgentExtensionTreeNavigationOptions {
	readonly summarize?: boolean;
	readonly customInstructions?: string;
	readonly replaceInstructions?: boolean;
	readonly label?: string;
}

export interface CodingAgentExtensionCommandActionPorts {
	waitForIdle(): Promise<void>;
	newSession(options?: CodingAgentNewSessionOptions): Promise<{ cancelled: boolean }>;
	createSessionSetupInitializer(setup: ExtensionSessionSetup): CodingAgentSessionSeedInitializer;
	fork(entryId: string): Promise<{ readonly cancelled: boolean }>;
	navigateTree(targetId: string, options?: CodingAgentExtensionTreeNavigationOptions): Promise<{ cancelled: boolean }>;
	switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
	reload(): Promise<void>;
}

export interface CodingAgentExtensionCommandHost {
	readCommands(): readonly SlashCommandInfo[];
	tryExecute(text: string): Promise<boolean>;
	throwIfExtensionCommand(text: string): void;
}

export interface CodingAgentExtensionCommandHostOptions {
	readonly runner: ExtensionRunner;
	readonly actions: ExtensionCommandContextActions;
}

export interface CodingAgentExtensionInitialization {
	readonly uiContext?: ExtensionUIContext;
	readonly shutdownHandler?: () => void;
	readonly onError?: (error: ExtensionError) => void;
}

export interface CodingAgentExtensionEventHost {
	readonly runner: ExtensionRunner;
	initialize(
		input?: CodingAgentExtensionInitialization,
		lifecycle?: { readonly emitSessionStart?: boolean },
	): Promise<void>;
	shutdown(): Promise<void>;
	discoverResources(reason: "startup" | "reload"): Promise<void>;
	readSystemPrompt(): string;
	rebindRuntimeActions(): void;
	rebindRuntimeBindings(): void;
	dispose(lifecycle?: { readonly emitSessionShutdown?: boolean }): Promise<void>;
}

export type CodingAgentExtensionEventHostFactory = (
	session: GreenfieldRuntimeSession,
	options?: { readonly replaceExisting?: boolean },
) => CodingAgentExtensionEventHost;

export interface CodingAgentExtensionSessionHost {
	bindCommandContext(actions: ExtensionCommandContextActions): void;
	readRunner(): ExtensionRunner;
	readCommands(): readonly SlashCommandInfo[];
	tryExecute(text: string): Promise<boolean>;
	throwIfExtensionCommand(text: string): void;
	initialize(input: CodingAgentExtensionInitialization): Promise<void>;
	before(
		transition: CodingAgentSessionTransition,
	): Promise<{ readonly cancelled: boolean; readonly skipConversationRestore?: boolean } | undefined>;
	prepare(
		transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession },
	): Promise<CodingAgentPreparedSessionBinding>;
	after(transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession }): Promise<void>;
	reload(session: GreenfieldRuntimeSession, operation: () => Promise<void>): Promise<void>;
	shutdown(): Promise<void>;
	dispose(): Promise<void>;
}
