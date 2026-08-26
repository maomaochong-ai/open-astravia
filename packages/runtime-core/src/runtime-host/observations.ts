import { defineRuntimeObservation, type RuntimeObservationFailure } from "../observation/index.js";

export type RuntimeHostLifecycleOperation = "host.close" | "session.dispose";

export interface RuntimeHostLifecycleObservation {
	readonly operation: RuntimeHostLifecycleOperation;
	readonly phase: "started" | "completed" | "failed";
	readonly component?: "sessions" | "session-backend" | "agent-runtime" | "observation-publisher" | "observation-port";
	readonly failure?: RuntimeObservationFailure;
}

/** RuntimeHost 资源所有权与关闭问题的内容安全观测，不携带会话正文或原始错误文本。 */
export const RUNTIME_HOST_LIFECYCLE_OBSERVATION = defineRuntimeObservation<RuntimeHostLifecycleObservation>(
	"runtime.host",
	"lifecycle",
);
