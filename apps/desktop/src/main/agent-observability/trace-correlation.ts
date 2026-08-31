import { AGENT_CONFIGURATION_OBSERVATION } from "@vetta/coding-agent/session-extensions";
import { RUNTIME_EXECUTION_TRACE } from "@vetta/runtime-core/observation";
import type { RuntimeTraceRecord } from "@vetta/runtime-telemetry";

/** Joins immutable, recorded identities; never consults the current live session/configuration. */
export function correlateAgentTraces(records: readonly RuntimeTraceRecord[]): RuntimeTraceRecord[] {
	const identities = new Map<string, RuntimeTraceRecord["context"]>();
	const configurations = new Map<string, number>();
	for (const record of records) {
		if (record.name === RUNTIME_EXECUTION_TRACE.id) identities.set(record.traceId, record.context);
		if (
			record.name === AGENT_CONFIGURATION_OBSERVATION.id &&
			record.metadata.operation === "apply" &&
			record.metadata.phase === "completed" &&
			record.context.turnId &&
			typeof record.metadata.revision === "number"
		) {
			configurations.set(turnKey(record), record.metadata.revision);
		}
	}
	return records.map((record) => {
		const revision = configurations.get(turnKey(record));
		return {
			...record,
			context: { ...record.context, ...identities.get(record.traceId) },
			metadata: { ...record.metadata, ...(revision !== undefined ? { configurationRevision: revision } : {}) },
		};
	});
}
function turnKey(record: RuntimeTraceRecord): string {
	return JSON.stringify([record.context.sessionId, record.context.turnId]);
}
