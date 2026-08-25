import { defineRuntimeObservation, type RuntimeObservationRecord } from "@vetta/runtime-core/observation";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeTracer } from "./index.js";
import { createRuntimeObservationLoggerPort, createRuntimeObservationTracerPort } from "./observation-adapters.js";

const TEST_OBSERVATION = defineRuntimeObservation<{ readonly count: number }>("test.domain", "completed", "warning");

describe("Runtime observation adapters", () => {
	it("maps a safe Observation record to the structured logger", () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const port = createRuntimeObservationLoggerPort({ logger });

		port.record(record());

		expect(logger.warn).toHaveBeenCalledWith("[runtime-observation] test.domain.completed", {
			sessionId: "session-1",
			requestId: "trace-1",
			toolCallId: "call-1",
			meta: expect.objectContaining({
				tokenId: "test.domain.completed",
				identity: { sessionId: "session-1", toolCallId: "call-1", traceId: "trace-1" },
				payload: { count: 2 },
			}),
		});
		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("projects a flat event into AgentTracer and delegates flush without owning shutdown", async () => {
		const end = vi.fn();
		const flush = vi.fn(async () => undefined);
		const shutdown = vi.fn(async () => undefined);
		const startObservation = vi.fn(() => ({
			id: "observation-1",
			traceId: "native-trace-1",
			type: "event" as const,
			startObservation,
			update: vi.fn(),
			end,
		}));
		const tracer: RuntimeTracer = { startObservation, flush, shutdown };
		const port = createRuntimeObservationTracerPort({ tracer, includePayload: false });

		port.record(record());
		await port.flush?.();

		expect(startObservation).toHaveBeenCalledWith(
			"test.domain.completed",
			expect.objectContaining({
				level: "WARNING",
				sessionId: "session-1",
				traceName: "test.domain",
				metadata: expect.not.objectContaining({ payload: expect.anything() }),
			}),
			{ type: "event" },
		);
		expect(end).toHaveBeenCalledOnce();
		expect(flush).toHaveBeenCalledOnce();
		expect(shutdown).not.toHaveBeenCalled();
	});
});

function record(): RuntimeObservationRecord<{ readonly count: number }> {
	return {
		token: TEST_OBSERVATION,
		context: { sessionId: "session-1", toolCallId: "call-1", traceId: "trace-1" },
		timestamp: 42,
		payload: { count: 2 },
	};
}
