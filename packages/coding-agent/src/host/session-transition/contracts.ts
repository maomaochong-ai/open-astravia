import type {
	RuntimeActiveSession,
	RuntimeActiveSessionTransition,
	RuntimeActiveSessionTransitionDecision,
	RuntimeActiveSessionTransitionKind,
	RuntimeActiveSessionTransitionLifecycle,
	RuntimeNewSessionOptions,
	RuntimePreparedSessionBinding,
	RuntimeSessionSeedInitializer,
	RuntimeSessionSeedTarget,
} from "@vetta/runtime-core";

export type CodingAgentSessionTransition<TSession extends RuntimeActiveSession = RuntimeActiveSession> =
	RuntimeActiveSessionTransition<TSession>;
export type CodingAgentSessionTransitionDecision = RuntimeActiveSessionTransitionDecision;
export type CodingAgentSessionTransitionKind = RuntimeActiveSessionTransitionKind;
export type CodingAgentSessionTransitionLifecycle<TSession extends RuntimeActiveSession = RuntimeActiveSession> =
	RuntimeActiveSessionTransitionLifecycle<TSession>;
export type CodingAgentNewSessionOptions = RuntimeNewSessionOptions;
export type CodingAgentPreparedSessionBinding = RuntimePreparedSessionBinding;
export type CodingAgentSessionSeedInitializer = RuntimeSessionSeedInitializer;
export type CodingAgentSessionSeedTarget = RuntimeSessionSeedTarget;
