import { join } from "node:path";
import { RuntimeTraceRecorder, type RuntimeTracer } from "@vetta/runtime-telemetry";
import { createLangfuseRuntimeTracerFromEnv } from "@vetta/runtime-telemetry/langfuse";
import type { AgentObservationQuery } from "./contracts.js";
import { LocalAgentObservationRepository } from "./local-observation-repository.js";

/** The Runtime composition owns both native execution spans and Hub observations. */
export function createDesktopAgentObservability(
	agentDir: string,
	logger: { warn(message: string, fields: Record<string, unknown>): void },
) {
	const repository = new LocalAgentObservationRepository({
		// Keep the v1 checkpoint path so existing diagnostics remain readable.
		path: join(agentDir, "agent-traces.json"),
		onIssue: (code) => logger.warn("[agent-observability] local diagnostics degraded", { code }),
	});
	let remote: RuntimeTracer | undefined;
	try {
		remote = createLangfuseRuntimeTracerFromEnv();
	} catch {
		repository.reportIssue("TRACE_ADAPTER_FAILED");
	}
	const recorder = new RuntimeTraceRecorder({
		write: (record) => repository.append(record),
		flush: () => repository.flush(),
		remote,
		onIssue: (code) => repository.reportIssue(code),
	});
	return {
		tracer: recorder,
		port: recorder,
		query: (query: AgentObservationQuery) => repository.query(query),
		close: () => recorder.close(),
	};
}
