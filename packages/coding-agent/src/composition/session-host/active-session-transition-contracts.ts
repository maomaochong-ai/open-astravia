import type { RuntimeActiveSessionHostOptions, RuntimeActiveSessionRuntimePort } from "@vetta/runtime-core";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";

export type {
	CodingAgentPreparedSessionBinding,
	CodingAgentSessionTransition,
	CodingAgentSessionTransitionDecision,
	CodingAgentSessionTransitionKind,
	CodingAgentSessionTransitionLifecycle,
} from "../../host/session-transition/contracts.js";

export type CodingAgentSessionTransitionRuntimePort = RuntimeActiveSessionRuntimePort<CodingAgentRuntimeSessionOptions>;

export type CodingAgentActiveSessionHostOptions = RuntimeActiveSessionHostOptions<CodingAgentRuntimeSessionOptions>;
