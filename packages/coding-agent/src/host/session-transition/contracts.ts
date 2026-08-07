import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";

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

export type CodingAgentSessionTransitionKind = "new" | "resume" | "fork";

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
