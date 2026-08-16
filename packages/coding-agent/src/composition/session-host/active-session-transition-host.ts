import { RuntimeActiveSessionHost } from "@vetta/runtime-core";
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
export class CodingAgentActiveSessionHost extends RuntimeActiveSessionHost<CodingAgentRuntimeSessionOptions> {
	constructor(options: CodingAgentActiveSessionHostOptions) {
		super({ ...options, logLabel: "CodingAgentActiveSessionHost" });
	}
}
