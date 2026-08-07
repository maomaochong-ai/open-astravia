import type {
	GreenfieldRuntimeSession,
	GreenfieldRuntimeSessionBackend,
	RuntimeSessionCatalog,
} from "@vetta/runtime-core";
import type {
	CodingAgentSessionTransition,
	CodingAgentSessionTransitionLifecycle,
} from "../../host/session-transition/contracts.js";
import type { CodingAgentRuntimeSessionHookLifecycle, CodingAgentRuntimeSessionOptions } from "../contracts/index.js";

export type {
	CodingAgentPreparedSessionBinding,
	CodingAgentSessionTransition,
	CodingAgentSessionTransitionDecision,
	CodingAgentSessionTransitionKind,
	CodingAgentSessionTransitionLifecycle,
} from "../../host/session-transition/contracts.js";

export interface CodingAgentSessionTransitionRuntimePort {
	readonly backend: GreenfieldRuntimeSessionBackend<CodingAgentRuntimeSessionOptions>;
	readonly sessionHooks: CodingAgentRuntimeSessionHookLifecycle;
	quiesceSessionBackgroundCommands(sessionId: string): Promise<void>;
	preserveSessionExecutionContext(sourceSessionId: string, targetSessionId: string): Promise<void>;
}

export interface CodingAgentActiveSessionHostOptions {
	readonly runtime: CodingAgentSessionTransitionRuntimePort;
	readonly initialSession: GreenfieldRuntimeSession;
	readonly sessionOptions: Omit<CodingAgentRuntimeSessionOptions, "sessionId" | "parentSessionPath" | "parentEntryId">;
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
