import type { Message } from "@vetta/ai";
import type { PromptRequest, SessionEvent } from "../contracts.js";
import type { RuntimeObservationPublisher } from "../observation/index.js";
import type { SessionExtensionEndpointToken } from "../session-extensions/contracts.js";
import type { RuntimeSessionExecutionObservation, RuntimeSessionState } from "./session-ports.js";
import type { RuntimeSessionCatalog } from "./session-services.js";
import type { RuntimePreparedSessionBinding } from "./session-transition-cleanup.js";

/** Active identity transaction 所需的最小 Session 面；不暴露 Kernel assembly。 */
export interface RuntimeActiveSession {
	readonly sessionId: string;
	readonly sessionPath: string | undefined;
	prompt(request: PromptRequest): Promise<unknown>;
	continue(): Promise<unknown>;
	retry(): Promise<unknown>;
	abort(reason?: string): Promise<void>;
	readState(): RuntimeSessionState;
	readMessages(): readonly Message[];
	subscribe(handler: (event: SessionEvent) => void): () => void;
	subscribeExecutionObservations(
		handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void;
	hasExtension?<Input, Output>(token: SessionExtensionEndpointToken<Input, Output>): boolean;
	invokeExtension?<Input, Output>(
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal?: AbortSignal,
	): Promise<Output>;
	invokeExtensionSync?<Input, Output>(token: SessionExtensionEndpointToken<Input, Output>, input: Input): Output;
	navigateForEdit(entryId: string): Promise<{ text: string; cancelled: boolean }>;
	forkSession(entryId: string): Promise<{ path: string; text: string }>;
	dispose(): Promise<void>;
}

export interface RuntimeActiveSessionCreateOptions {
	readonly sessionId: string;
	readonly cwd?: string;
	readonly parentSessionPath?: string;
	readonly parentEntryId?: string;
}

export interface RuntimeSessionSeedTarget {
	readonly cwd: string;
	readonly parentSession?: string;
	readonly targetRootDir: string;
	readonly targetSessionId: string;
}

export interface RuntimeSessionSeedInitializer {
	initializeSeed(target: RuntimeSessionSeedTarget): Promise<void>;
}

export interface RuntimeNewSessionOptions {
	readonly parentSession?: string;
	readonly seedInitializer?: RuntimeSessionSeedInitializer;
}

export type RuntimeActiveSessionTransitionKind = "new" | "resume" | "fork";

export interface RuntimeActiveSessionTransition<TSession extends RuntimeActiveSession = RuntimeActiveSession> {
	readonly kind: RuntimeActiveSessionTransitionKind;
	readonly previous: TSession;
	readonly next?: TSession;
	readonly previousSessionPath: string | undefined;
	readonly targetSessionPath?: string;
	readonly entryId?: string;
}

export interface RuntimeActiveSessionTransitionDecision {
	readonly cancelled: boolean;
	readonly skipConversationRestore?: boolean;
}

export interface RuntimeActiveSessionTransitionLifecycle<TSession extends RuntimeActiveSession = RuntimeActiveSession> {
	before?(
		transition: RuntimeActiveSessionTransition<TSession>,
	): Promise<RuntimeActiveSessionTransitionDecision | undefined>;
	prepare?(
		transition: RuntimeActiveSessionTransition<TSession> & { readonly next: TSession },
	): Promise<RuntimePreparedSessionBinding | undefined>;
	after?(transition: RuntimeActiveSessionTransition<TSession> & { readonly next: TSession }): Promise<void>;
}

export type RuntimeActiveSessionEndCause = "new_session" | "switch_session" | "fork_session";
export type RuntimeActiveSessionStartSource = "resume" | "clear";

export interface RuntimeActiveSessionHookLifecycle {
	end(sessionId: string, cause: RuntimeActiveSessionEndCause): Promise<void>;
	start(sessionId: string, source: RuntimeActiveSessionStartSource): void;
	discard(sessionId: string): void;
}

export interface RuntimeActiveSessionRuntimePort<
	TSessionOptions extends RuntimeActiveSessionCreateOptions = RuntimeActiveSessionCreateOptions,
	TSession extends RuntimeActiveSession = RuntimeActiveSession,
> {
	readonly sessions: {
		create(options: TSessionOptions): Promise<TSession>;
		resume(options: TSessionOptions): Promise<TSession>;
	};
	readonly sessionHooks: RuntimeActiveSessionHookLifecycle;
	quiesceSessionBackgroundCommands(sessionId: string): Promise<void>;
	preserveSessionExecutionContext(sourceSessionId: string, targetSessionId: string): Promise<void>;
}

export interface RuntimeActiveSessionHostOptions<
	TSessionOptions extends RuntimeActiveSessionCreateOptions = RuntimeActiveSessionCreateOptions,
	TSession extends RuntimeActiveSession = RuntimeActiveSession,
> {
	readonly runtime: RuntimeActiveSessionRuntimePort<TSessionOptions, TSession>;
	readonly initialSession: TSession;
	readonly sessionOptions: Omit<TSessionOptions, "sessionId" | "parentSessionPath" | "parentEntryId">;
	readonly conversationDir: string;
	readonly defaultCwd: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly createSessionId: () => string;
	readonly resolveSessionId: (sessionPath: string) => string | undefined;
	readonly resolveSessionPath: (sessionId: string) => string;
	readonly lifecycle?: RuntimeActiveSessionTransitionLifecycle<TSession>;
	/** 把监听器与已提交切换的清理失败汇入上层 Observation；Publisher 生命周期仍由调用方持有。 */
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly logLabel?: string;
	readonly onTransitionCleanupError?: (
		error: AggregateError,
		transition: RuntimeActiveSessionTransition<TSession> & { readonly next: TSession },
	) => void;
}
