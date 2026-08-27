import type {
	RuntimeActiveSession,
	RuntimeActiveSessionHostOptions,
	RuntimeActiveSessionRuntimePort,
} from "@vetta/runtime-core";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";

export type {
	CodingAgentPreparedSessionBinding,
	CodingAgentSessionTransition,
	CodingAgentSessionTransitionDecision,
	CodingAgentSessionTransitionKind,
	CodingAgentSessionTransitionLifecycle,
} from "../../host/session-transition/contracts.js";

export type CodingAgentSessionTransitionRuntimePort<TSession extends RuntimeActiveSession = RuntimeActiveSession> =
	RuntimeActiveSessionRuntimePort<CodingAgentRuntimeSessionOptions, TSession>;

export type CodingAgentActiveSessionHostOptions<TSession extends RuntimeActiveSession = RuntimeActiveSession> =
	RuntimeActiveSessionHostOptions<CodingAgentRuntimeSessionOptions, TSession>;
