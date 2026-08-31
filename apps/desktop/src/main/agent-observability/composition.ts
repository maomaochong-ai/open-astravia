import { join } from "node:path";
import { getAgentDir } from "@vetta/coding-agent/config";
import { RuntimeTraceRecorder, type RuntimeTracer } from "@vetta/runtime-telemetry";
import { createLangfuseRuntimeTracerFromEnv } from "@vetta/runtime-telemetry/langfuse";
import { getAppLogger } from "../logger.js";
import { LocalTraceRepository } from "./local-trace-repository.js";

let repository: LocalTraceRepository | undefined;
export function getAgentTraceRepository(): LocalTraceRepository {
	repository ??= new LocalTraceRepository({
		path: join(getAgentDir(), "agent-traces.json"),
		onIssue: (code) => getAppLogger("agent-traces").warn("[agent-traces] local diagnostics degraded", { code }),
	});
	return repository;
}
export function createDesktopAgentTraceRecorder(): RuntimeTraceRecorder {
	const repository = getAgentTraceRepository();
	let remote: RuntimeTracer | undefined;
	try {
		remote = createLangfuseRuntimeTracerFromEnv();
	} catch {
		repository.reportIssue("TRACE_ADAPTER_FAILED");
	}
	return new RuntimeTraceRecorder({
		write: (record) => repository.append(record),
		flush: () => repository.flush(),
		remote,
		onIssue: (code) => repository.reportIssue(code),
	});
}
