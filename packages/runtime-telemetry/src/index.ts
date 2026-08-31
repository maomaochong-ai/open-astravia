// Backward-compatible names. The execution-facing observation contract is owned by agent-core.
export type {
	AgentCostDetails as RuntimeCostDetails,
	AgentObservation as RuntimeObservation,
	AgentObservationLevel as RuntimeObservationLevel,
	AgentObservationStartOptions as RuntimeObservationStartOptions,
	AgentObservationType as RuntimeObservationType,
	AgentObservationUpdate as RuntimeObservationUpdate,
	AgentTracer as RuntimeTracer,
	AgentUsageDetails as RuntimeUsageDetails,
} from "@vetta/agent-core";
export { ConsoleRuntimeLogger, type LoggerContext, type RuntimeLogger } from "./logger.js";
export {
	createRuntimeObservationLoggerPort,
	createRuntimeObservationTracerPort,
	type RuntimeObservationLoggerPortOptions,
	type RuntimeObservationTracerPortOptions,
} from "./observation-adapters.js";
export {
	parseRuntimeTraceRecord,
	type RuntimeTraceMetadata,
	type RuntimeTraceRecord,
	type RuntimeTraceState,
	safeTraceContext,
	safeTraceMetadata,
	traceIdentifier,
	traceObject,
} from "./trace-record.js";
export { RuntimeTraceRecorder, type RuntimeTraceRecorderOptions } from "./trace-recorder.js";
