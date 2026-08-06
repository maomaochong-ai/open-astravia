import type {
	GreenfieldRuntimeSession,
	GreenfieldRuntimeSessionBackend,
	RuntimeSessionCatalog,
} from "@vetta/runtime-core";
import type {
	GreenfieldRuntimeSessionHookLifecycle,
	GreenfieldRuntimeSessionOptions,
} from "../greenfield-runtime-composition-contract.js";

export type CodingAgentSessionTransitionKind = "new" | "resume" | "fork";

export interface CodingAgentSessionSeedTarget {
	readonly cwd: string;
	readonly parentSession?: string;
	readonly targetRootDir: string;
	readonly targetSessionId: string;
}

export interface CodingAgentSessionSeedInitializer {
	initializeSeed(target: CodingAgentSessionSeedTarget): Promise<void>;
}

export interface CodingAgentNewSessionOptions {
	readonly parentSession?: string;
	readonly seedInitializer?: CodingAgentSessionSeedInitializer;
}

export interface CodingAgentSessionTransition {
	readonly kind: CodingAgentSessionTransitionKind;
	readonly previous: GreenfieldRuntimeSession;
	readonly next?: GreenfieldRuntimeSession;
	readonly previousSessionPath: string | undefined;
	readonly targetSessionPath?: string;
	readonly entryId?: string;
}

export interface CodingAgentPreparedSessionBinding {
	commit(): Promise<void>;
	rollback(): Promise<void>;
	finalize(): Promise<void>;
}

export interface CodingAgentSessionTransitionDecision {
	readonly cancelled: boolean;
	readonly skipConversationRestore?: boolean;
}

export interface CodingAgentSessionTransitionLifecycle {
	before?(transition: CodingAgentSessionTransition): Promise<CodingAgentSessionTransitionDecision | undefined>;
	prepare?(
		transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession },
	): Promise<CodingAgentPreparedSessionBinding | undefined>;
	after?(transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession }): Promise<void>;
}

export interface CodingAgentSessionTransitionRuntimePort {
	readonly backend: GreenfieldRuntimeSessionBackend<GreenfieldRuntimeSessionOptions>;
	readonly sessionHooks: GreenfieldRuntimeSessionHookLifecycle;
	quiesceSessionBackgroundCommands(sessionId: string): Promise<void>;
	preserveSessionExecutionContext(sourceSessionId: string, targetSessionId: string): Promise<void>;
}

export interface CodingAgentActiveSessionHostOptions {
	readonly runtime: CodingAgentSessionTransitionRuntimePort;
	readonly initialSession: GreenfieldRuntimeSession;
	readonly sessionOptions: Omit<GreenfieldRuntimeSessionOptions, "sessionId" | "parentSessionPath" | "parentEntryId">;
	readonly conversationDir: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly createSessionId: () => string;
	readonly resolveSessionId: (sessionPath: string) => string | undefined;
	readonly lifecycle?: CodingAgentSessionTransitionLifecycle;
	readonly onTransitionCleanupError?: (
		error: AggregateError,
		transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession },
	) => void;
}
