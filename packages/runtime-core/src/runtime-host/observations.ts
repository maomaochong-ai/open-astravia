import { defineRuntimeObservation, type RuntimeObservationFailure } from "../observation/index.js";

export type RuntimeHostLifecycleOperation =
	| "host.close"
	| "session.dispose"
	| "session.prepare"
	| "session.persist"
	| "session.rebind"
	| "auth.refresh"
	| "listener.notify"
	| "observer.notify";

export interface RuntimeHostLifecycleObservation {
	readonly operation: RuntimeHostLifecycleOperation;
	readonly phase: "started" | "completed" | "failed";
	readonly component?:
		| "session-creations"
		| "sessions"
		| "agent-backends"
		| "session-backend"
		| "agent-runtime"
		| "shared-model"
		| "session-model"
		| "running-listener"
		| "session-event-listener"
		| "session-error-observer"
		| "session-compaction-observer"
		| "session-workspace"
		| "queue-sidecar"
		| "observation-publisher"
		| "observation-port";
	readonly failure?: RuntimeObservationFailure;
}

/** RuntimeHost 资源所有权与关闭问题的内容安全观测，不携带会话正文或原始错误文本。 */
export const RUNTIME_HOST_LIFECYCLE_OBSERVATION = defineRuntimeObservation<RuntimeHostLifecycleObservation>(
	"runtime.host",
	"lifecycle",
);

export type RuntimeActiveSessionHostOperation = "listener.notify" | "transition.cleanup" | "reporter.notify";

export interface RuntimeActiveSessionHostObservation {
	readonly operation: RuntimeActiveSessionHostOperation;
	readonly phase: "failed";
	readonly component: "event-listener" | "execution-observation-listener" | "retired-session" | "cleanup-reporter";
	readonly transitionKind?: "new" | "resume" | "fork";
	readonly failure: RuntimeObservationFailure;
}

/** 活动 Session 切换器的内容安全失败观测；不包含路径、事件正文或原始错误文本。 */
export const RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION = defineRuntimeObservation<RuntimeActiveSessionHostObservation>(
	"runtime.active-session",
	"lifecycle",
	"warning",
);

export type RuntimeHostAgentBackendOperation =
	| "register"
	| "replace"
	| "retire"
	| "remove"
	| "route.acquire"
	| "route.release"
	| "backend.dispose"
	| "install";

export interface RuntimeHostAgentBackendObservation {
	readonly operation: RuntimeHostAgentBackendOperation;
	readonly phase: "started" | "completed" | "failed";
	readonly backendRevisionId?: string;
	readonly sourceId?: string;
	readonly sourceRevision?: string;
	readonly routeSource?: "agent" | "catalog" | "default";
	readonly activeLeaseCount?: number;
	readonly failure?: RuntimeObservationFailure;
}

/** 主 Agent Backend admission、路由与代际回收的内容安全观测。 */
export const RUNTIME_HOST_AGENT_BACKEND_OBSERVATION = defineRuntimeObservation<RuntimeHostAgentBackendObservation>(
	"runtime.host",
	"agent-backend",
);
