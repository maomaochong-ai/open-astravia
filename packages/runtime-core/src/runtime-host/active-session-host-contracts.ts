import type { KernelRuntimeSessionBackend, RuntimeSession } from "./kernel-runtime-session-backend.js";
import type { RuntimeSessionCatalog } from "./session-services.js";
import type { RuntimePreparedSessionBinding } from "./session-transition-cleanup.js";

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

export interface RuntimeActiveSessionTransition {
	readonly kind: RuntimeActiveSessionTransitionKind;
	readonly previous: RuntimeSession;
	readonly next?: RuntimeSession;
	readonly previousSessionPath: string | undefined;
	readonly targetSessionPath?: string;
	readonly entryId?: string;
}

export interface RuntimeActiveSessionTransitionDecision {
	readonly cancelled: boolean;
	readonly skipConversationRestore?: boolean;
}

export interface RuntimeActiveSessionTransitionLifecycle {
	before?(transition: RuntimeActiveSessionTransition): Promise<RuntimeActiveSessionTransitionDecision | undefined>;
	prepare?(
		transition: RuntimeActiveSessionTransition & { readonly next: RuntimeSession },
	): Promise<RuntimePreparedSessionBinding | undefined>;
	after?(transition: RuntimeActiveSessionTransition & { readonly next: RuntimeSession }): Promise<void>;
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
> {
	readonly backend: KernelRuntimeSessionBackend<TSessionOptions>;
	readonly sessionHooks: RuntimeActiveSessionHookLifecycle;
	quiesceSessionBackgroundCommands(sessionId: string): Promise<void>;
	preserveSessionExecutionContext(sourceSessionId: string, targetSessionId: string): Promise<void>;
}

export interface RuntimeActiveSessionHostOptions<
	TSessionOptions extends RuntimeActiveSessionCreateOptions = RuntimeActiveSessionCreateOptions,
> {
	readonly runtime: RuntimeActiveSessionRuntimePort<TSessionOptions>;
	readonly initialSession: RuntimeSession;
	readonly sessionOptions: Omit<TSessionOptions, "sessionId" | "parentSessionPath" | "parentEntryId">;
	readonly conversationDir: string;
	readonly defaultCwd: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly createSessionId: () => string;
	readonly resolveSessionId: (sessionPath: string) => string | undefined;
	readonly resolveSessionPath: (sessionId: string) => string;
	readonly lifecycle?: RuntimeActiveSessionTransitionLifecycle;
	readonly logLabel?: string;
	readonly onTransitionCleanupError?: (
		error: AggregateError,
		transition: RuntimeActiveSessionTransition & { readonly next: RuntimeSession },
	) => void;
}
