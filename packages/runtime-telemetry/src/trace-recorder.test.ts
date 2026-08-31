import { defineRuntimeObservation } from "@vetta/runtime-core/observation";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeObservation, RuntimeTracer } from "./index.js";
import { parseRuntimeTraceRecord, type RuntimeTraceRecord } from "./trace-record.js";
import { RuntimeTraceRecorder } from "./trace-recorder.js";

describe("safe local/native Trace recorder", () => {
	it("records native hierarchy, usage and terminal state while filtering all content for local and remote sinks", async () => {
		const rows = new Map<string, RuntimeTraceRecord>();
		const exported: unknown[] = [];
		const remote = remoteTracer(exported);
		let index = 0,
			now = 100;
		const recorder = new RuntimeTraceRecorder({
			write: (row) => {
				rows.set(row.id, row);
			},
			flush: async () => {},
			remote,
			createId: () => `id-${++index}`,
			now: () => now,
		});
		const root = recorder.startObservation(
			"agent.run",
			{ sessionId: "session", input: "secret-input", metadata: { turnId: "turn", prompt: "secret-prompt" } },
			{ type: "agent" },
		);
		const child = root.startObservation(
			"llm.model",
			{ metadata: { modelCallId: "call", provider: "test" } },
			{ type: "generation" },
		);
		now = 150;
		child.end({
			output: "secret-output",
			statusMessage: "secret-error",
			level: "ERROR",
			usageDetails: { input: 4, output: 2, totalTokens: 6, secret: 100 },
			metadata: { errorMessage: "secret-error", status: "failed" },
		});
		child.end({ usageDetails: { input: 999 } });
		root.end();
		expect(rows.get(child.id)).toMatchObject({
			parentSpanId: root.id,
			traceId: root.traceId,
			state: "error",
			startedAt: 100,
			endedAt: 150,
			context: { sessionId: "session", turnId: "turn", modelCallId: "call" },
			usage: { input: 4, output: 2, totalTokens: 6 },
		});
		expect(JSON.stringify([...rows.values(), ...exported])).not.toContain("secret");
		await recorder.close();
		await recorder.close();
		expect(remote.shutdown).toHaveBeenCalledTimes(1);
	});

	it("records only allowlisted event summaries and isolates sink/exporter/capacity failures", async () => {
		const write = vi.fn((_record: RuntimeTraceRecord) => {
			throw new Error("private disk");
		});
		const issue = vi.fn();
		const recorder = new RuntimeTraceRecorder({
			write,
			flush: async () => {
				throw new Error("private flush");
			},
			maxOpenSpans: 1,
			onIssue: issue,
			remote: {
				startObservation: () => {
					throw new Error("private remote");
				},
			},
		});
		const root = recorder.startObservation("agent.run");
		expect(root.startObservation("child").id).toBe("dropped");
		recorder.record({
			token: defineRuntimeObservation("test", "event"),
			context: { sessionId: "session" },
			timestamp: 1,
			payload: {
				count: 2,
				input: "private payload",
				phase: "failed",
				failure: { errorCode: "TEST_FAILURE", message: "private error body" },
			},
		});
		expect(write.mock.calls.at(-1)?.[0]).toMatchObject({
			state: "error",
			metadata: { count: 2, phase: "failed", code: "TEST_FAILURE" },
		});
		await expect(recorder.close()).resolves.toBeUndefined();
		expect(issue).toHaveBeenCalledWith("TRACE_CAPACITY");
		expect(issue).toHaveBeenCalledWith("TRACE_ADAPTER_FAILED");
		expect(JSON.stringify(write.mock.calls)).not.toContain("private");
	});

	it("rejects unknown or invalid persisted formats and strips unknown nested fields", () => {
		const row = {
			schemaVersion: 1,
			id: "id",
			traceId: "trace",
			name: "span",
			kind: "span",
			startedAt: 1,
			state: "completed",
			context: { sessionId: "session", secret: "private" },
			metadata: { count: 2, input: "private" },
			usage: { totalTokens: Infinity },
			cost: {},
			input: "private",
		};
		expect(JSON.stringify(parseRuntimeTraceRecord(row))).not.toContain("private");
		for (const invalid of [
			{ ...row, schemaVersion: 2 },
			{ ...row, startedAt: NaN },
			{ ...row, endedAt: 0 },
			{ ...row, id: "bad\nvalue" },
		])
			expect(parseRuntimeTraceRecord(invalid)).toBeUndefined();
	});
});

function remoteTracer(exported: unknown[]): RuntimeTracer & { shutdown: ReturnType<typeof vi.fn> } {
	const startObservation = (name: string, update?: unknown): RuntimeObservation => {
		exported.push({ name, update });
		return {
			id: "remote-span",
			traceId: "remote-trace",
			type: "span",
			startObservation,
			update: (value) => {
				exported.push(value);
			},
			end: (value) => {
				exported.push(value);
			},
		};
	};
	return { startObservation, shutdown: vi.fn(async () => {}) };
}
