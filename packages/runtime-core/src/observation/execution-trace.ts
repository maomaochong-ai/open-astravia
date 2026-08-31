import { defineRuntimeObservation } from "./observation.js";

/** Associates native execution spans with the immutable Agent/Session publisher scope. */
export const RUNTIME_EXECUTION_TRACE = defineRuntimeObservation<{ readonly spanId: string }>(
	"runtime.execution",
	"trace",
);
