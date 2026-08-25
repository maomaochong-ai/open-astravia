import { defineRuntimeObservation, type RuntimeObservationFailure } from "../observation/index.js";

export type RuntimeAgentLifecycleOperation =
	| "revision.publish"
	| "revision.acquire"
	| "revision.release"
	| "revision.retire"
	| "revision.remove"
	| "revision.dispose"
	| "source.sync"
	| "instance.create"
	| "instance.close"
	| "session.create"
	| "session.close"
	| "session.rollout";

export interface RuntimeAgentLifecycleObservation {
	readonly operation: RuntimeAgentLifecycleOperation;
	readonly phase: "started" | "completed" | "failed" | "superseded" | "unchanged";
	readonly sourceId?: string;
	readonly sourceRevision?: string;
	readonly definitionCount?: number;
	readonly removedCount?: number;
	readonly failure?: RuntimeObservationFailure;
}

export const RUNTIME_AGENT_LIFECYCLE_OBSERVATION = defineRuntimeObservation<RuntimeAgentLifecycleObservation>(
	"runtime.agent",
	"lifecycle",
);
