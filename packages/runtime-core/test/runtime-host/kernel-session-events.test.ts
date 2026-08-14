import { AIError, type AssistantMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../../src/contracts.js";
import type { KernelEvent } from "../../src/kernel/index.js";
import { mapKernelEventToSessionEvents } from "../../src/runtime-host/index.js";

function assistantMessage(stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: stopReason === "error" ? "provider failed" : "done" }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: {
			input: 10,
			output: 4,
			cacheRead: 2,
			cacheWrite: 1,
			totalTokens: 17,
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
		},
		stopReason,
		timestamp: 1,
	};
}

function payload(event: SessionEvent): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(event).filter(([key]) => !["schemaVersion", "sessionId", "eventId", "timestamp"].includes(key)),
	);
}

describe("Greenfield KernelEvent to SessionEvent adapter", () => {
	it("maps transient observations without changing their payload or source", () => {
		const events = mapKernelEventToSessionEvents({
			type: "session.observation",
			sessionId: "session-1",
			turnId: "turn-1",
			observation: { type: "message.delta", delta: "partial", source: "agent" },
			timestamp: 123,
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			sessionId: "session-1",
			timestamp: 123,
			source: "agent",
			type: "message.delta",
			delta: "partial",
		});
	});

	it("maps persisted assistant messages to final and usage events", () => {
		const events = mapKernelEventToSessionEvents({
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-1",
			message: assistantMessage(),
			timestamp: 123,
		});

		expect(events.map((event) => event.type)).toEqual(["message.final", "usage.update"]);
		expect(payload(events[1])).toEqual({
			source: "agent",
			type: "usage.update",
			input: 10,
			output: 4,
			cacheRead: 2,
			cacheWrite: 1,
			costTotal: 10,
			contextPercent: null,
			contextTokens: 17,
			contextWindow: 0,
		});
	});

	it("maps assistant provider errors and aborts with legacy-compatible semantics", () => {
		const failed = mapKernelEventToSessionEvents(messageEvent(assistantMessage("error")));
		const aborted = mapKernelEventToSessionEvents(messageEvent(assistantMessage("aborted")));

		expect(failed.map((event) => event.type)).toEqual(["message.final", "usage.update", "error"]);
		expect(payload(failed[2])).toMatchObject({
			turnId: "turn-1",
			error: { message: "provider failed", retryable: false, origin: "provider" },
		});
		expect(aborted.map((event) => event.type)).toEqual(["message.final", "usage.update", "session.lifecycle"]);
		expect(payload(aborted[2])).toMatchObject({ phase: "aborted", source: "runtime-core" });
	});

	it("maps cancellation, failure and compaction terminal events", () => {
		const cancelled = mapKernelEventToSessionEvents({
			type: "turn.cancelled",
			sessionId: "session-1",
			turnId: "turn-1",
			reason: "user",
			timestamp: 10,
		});
		const failed = mapKernelEventToSessionEvents({
			type: "turn.failed",
			sessionId: "session-1",
			turnId: "turn-1",
			error: { code: "turn_failed", message: "failed" },
			timestamp: 11,
		});
		const compacted = mapKernelEventToSessionEvents({
			type: "context.compacted",
			sessionId: "session-1",
			turnId: "turn-1",
			record: { id: "compact-1", sourceMessageCount: 10, resultMessageCount: 2 },
			timestamp: 12,
		});

		expect(cancelled.map((event) => event.type)).toEqual(["session.lifecycle", "session.lifecycle"]);
		expect(cancelled.map(payload)).toMatchObject([{ phase: "aborted" }, { phase: "agent_end" }]);
		expect(failed.map((event) => event.type)).toEqual(["error", "session.lifecycle"]);
		expect(payload(failed[0])).toMatchObject({ turnId: "turn-1", error: { code: "turn_failed", origin: "runtime" } });
		expect(compacted.map(payload)).toMatchObject([{ type: "compaction.end", success: true }]);
	});

	it("maps transient execution failures independently from durable turn failure", () => {
		const events = mapKernelEventToSessionEvents({
			type: "turn.execution_failed",
			sessionId: "session-1",
			turnId: "turn-1",
			error: {
				code: "AI_RATE_LIMITED",
				message: "provider rate limited",
				retryable: true,
				origin: "provider",
				details: { statusCode: 429, provider: "deepseek", modelId: "deepseek-chat" },
			},
			timestamp: 12,
		});

		expect(events.map((event) => event.type)).toEqual(["error", "session.lifecycle"]);
		expect(payload(events[0])).toMatchObject({
			type: "error",
			turnId: "turn-1",
			error: {
				code: "AI_RATE_LIMITED",
				origin: "provider",
				details: { provider: "deepseek", modelId: "deepseek-chat" },
			},
		});
	});

	it("preserves structured provider failures from the kernel", () => {
		const failed = mapKernelEventToSessionEvents({
			type: "turn.failed",
			sessionId: "session-1",
			turnId: "turn-1",
			error: {
				code: "AI_RATE_LIMITED",
				message: "too many requests",
				retryable: true,
				origin: "provider",
				details: {
					statusCode: 429,
					provider: "test-provider",
					modelId: "test-model",
					requestId: "request-1",
				},
			},
			timestamp: 11,
		});

		expect(payload(failed[0])).toMatchObject({
			type: "error",
			error: {
				code: "AI_RATE_LIMITED",
				message: "too many requests",
				retryable: true,
				origin: "provider",
				details: {
					statusCode: 429,
					provider: "test-provider",
					modelId: "test-model",
					requestId: "request-1",
				},
			},
		});
	});

	it("does not mark non-retryable assistant errors as retryable", () => {
		const events = mapKernelEventToSessionEvents({
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-1",
			message: {
				role: "assistant",
				content: [],
				api: "openai-completions",
				provider: "deepseek",
				model: "deepseek-chat",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error",
				errorMessage: "insufficient_quota: account has no remaining credits",
				timestamp: 1,
			},
			timestamp: 2,
		});

		expect(payload(events.at(-1)!)).toMatchObject({
			type: "error",
			error: { retryable: false, origin: "provider" },
		});
	});

	it("prefers the structured provider failure attached to an assistant message", () => {
		const failure = new AIError("AI_BILLING_REQUIRED", "quota exhausted", {
			retryable: false,
			statusCode: 402,
			provider: "deepseek",
			modelId: "deepseek-chat",
			requestId: "request-quota",
		});
		const events = mapKernelEventToSessionEvents({
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-1",
			message: assistantMessage("error"),
			failure: {
				code: failure.code,
				message: failure.message,
				retryable: failure.retryable,
				origin: "provider",
				details: {
					statusCode: failure.statusCode,
					provider: failure.provider,
					modelId: failure.modelId,
					requestId: failure.requestId,
				},
			},
			timestamp: 2,
		});

		expect(payload(events.at(-1)!)).toMatchObject({
			error: {
				code: "AI_BILLING_REQUIRED",
				message: "quota exhausted",
				retryable: false,
				details: { statusCode: 402, provider: "deepseek", modelId: "deepseek-chat", requestId: "request-quota" },
			},
		});
	});

	it("does not infer retryability from an unstructured assistant error message", () => {
		const events = mapKernelEventToSessionEvents(
			messageEvent({
				...assistantMessage("error"),
				errorMessage: "temporary 503 text without structured failure",
			}),
		);

		expect(payload(events.at(-1)!)).toMatchObject({
			type: "error",
			error: { retryable: false, origin: "provider" },
		});
	});

	it("does not expose persisted user messages or internal pipeline stages", () => {
		const userEvent: KernelEvent = {
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-1",
			message: { role: "user", content: "hello", timestamp: 1 },
			timestamp: 2,
		};
		const stageEvent: KernelEvent = {
			type: "pipeline.stage",
			sessionId: "session-1",
			turnId: "turn-1",
			stage: "execution",
			timestamp: 3,
		};

		expect(mapKernelEventToSessionEvents(userEvent)).toEqual([]);
		expect(mapKernelEventToSessionEvents(stageEvent)).toEqual([]);
	});
});

function messageEvent(message: AssistantMessage): KernelEvent {
	return {
		type: "message.appended",
		sessionId: "session-1",
		turnId: "turn-1",
		message,
		timestamp: 123,
	};
}
