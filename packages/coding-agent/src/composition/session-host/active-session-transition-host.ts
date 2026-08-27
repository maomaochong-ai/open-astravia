import { type RuntimeActiveSession, RuntimeActiveSessionHost } from "@vetta/runtime-core";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";
import type { CodingAgentActiveSessionHostOptions } from "./active-session-transition-contracts.js";

export type {
	CodingAgentNewSessionOptions,
	CodingAgentSessionSeedInitializer,
	CodingAgentSessionSeedTarget,
} from "../../host/session-transition/contracts.js";
export type {
	CodingAgentActiveSessionHostOptions,
	CodingAgentPreparedSessionBinding,
	CodingAgentSessionTransition,
	CodingAgentSessionTransitionDecision,
	CodingAgentSessionTransitionKind,
	CodingAgentSessionTransitionLifecycle,
	CodingAgentSessionTransitionRuntimePort,
} from "./active-session-transition-contracts.js";

/** Coding Agent compatibility name for the Runtime-owned active Session transaction host. */
export class CodingAgentActiveSessionHost<
	TSession extends RuntimeActiveSession = RuntimeActiveSession,
> extends RuntimeActiveSessionHost<CodingAgentRuntimeSessionOptions, TSession> {
	constructor(options: CodingAgentActiveSessionHostOptions<TSession>) {
		super({ ...options, logLabel: "CodingAgentActiveSessionHost" });
	}
}
