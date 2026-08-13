import type { RuntimeSessionEventStream, SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { DeferredRuntimeErrorEventStream } from "../../src/host/runtime-host/session-retry.js";

class TestEventStream implements RuntimeSessionEventStream {
	private readonly listeners = new Set<(event: SessionEvent) => void>();

	subscribe(handler: (event: SessionEvent) => void): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	emit(event: SessionEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}

describe("DeferredRuntimeErrorEventStream", () => {
	it("holds a failed attempt terminal lifecycle until retries are exhausted", () => {
		const source = new TestEventStream();
		const stream = new DeferredRuntimeErrorEventStream("session-1", source);
		const observed: SessionEvent[] = [];
		stream.subscribe((event) => observed.push(event));

		source.emit(errorEvent("first failure", "error-1"));
		source.emit(lifecycle("agent_end", "end-1"));
		expect(observed).toEqual([]);

		stream.emitRetry({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 2_000,
			errorMessage: "first failure",
		});
		source.emit(lifecycle("agent_start", "start-2"));
		source.emit(errorEvent("final failure", "error-2"));
		source.emit(lifecycle("agent_end", "end-2"));
		stream.emitRetry({ type: "auto_retry_end", success: false, attempt: 1, finalError: "final failure" });

		expect(observed.map(eventName)).toEqual(["retry.start", "agent_start", "retry.end"]);
		expect(stream.flushPendingError()).toBe(true);
		expect(observed.map(eventName)).toEqual(["retry.start", "agent_start", "retry.end", "error", "agent_end"]);
		expect(observed.at(-2)).toMatchObject({ type: "error", retryAttempts: 1 });
	});

	it("drops the held error and failed lifecycle after a successful retry", () => {
		const source = new TestEventStream();
		const stream = new DeferredRuntimeErrorEventStream("session-1", source);
		const observed: SessionEvent[] = [];
		stream.subscribe((event) => observed.push(event));

		source.emit(errorEvent("temporary failure", "error-1"));
		source.emit(lifecycle("agent_end", "end-1"));
		stream.emitRetry({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 2_000,
			errorMessage: "temporary failure",
		});
		source.emit(lifecycle("agent_start", "start-2"));
		source.emit(assistantFinal());
		source.emit(lifecycle("agent_end", "end-2"));
		stream.emitRetry({ type: "auto_retry_end", success: true, attempt: 1 });

		expect(observed.map(eventName)).toEqual([
			"retry.start",
			"agent_start",
			"message.final",
			"agent_end",
			"retry.end",
		]);
		expect(stream.flushPendingError()).toBe(false);
	});
});

function base(eventId: string) {
	return {
		schemaVersion: 1 as const,
		sessionId: "session-1",
		eventId,
		timestamp: 1,
		source: "runtime-core" as const,
	};
}

function errorEvent(message: string, eventId: string): SessionEvent {
	return {
		...base(eventId),
		type: "error",
		error: { code: "TRANSPORT_FAILED", message, retryable: true, origin: "provider" },
	};
}

function lifecycle(
	phase: Extract<SessionEvent, { type: "session.lifecycle" }>["phase"],
	eventId: string,
): SessionEvent {
	return { ...base(eventId), type: "session.lifecycle", phase };
}

function assistantFinal(): SessionEvent {
	return {
		...base("final-2"),
		type: "message.final",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "recovered" }],
			api: "openai-responses",
			provider: "openai",
			model: "test-model",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1,
		},
	};
}

function eventName(event: SessionEvent): string {
	return event.type === "session.lifecycle" ? event.phase : event.type;
}
