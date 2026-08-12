import type { SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { mapSessionEventToPetPresentation } from "./session-event-action-policy.js";

const eventBase = {
	schemaVersion: 1,
	sessionId: "session-1",
	eventId: "event-1",
	timestamp: 1,
	source: "runtime-core",
} as const;

describe("mapSessionEventToPetPresentation", () => {
	it("maps lifecycle events to structured notices without display text", () => {
		const event: SessionEvent = { ...eventBase, type: "session.lifecycle", phase: "agent_start" };

		expect(mapSessionEventToPetPresentation(event)?.bubble).toEqual({
			kind: "status",
			messageKey: "notice.lifecycle.started",
			ttlMs: 3_000,
			dedupeKey: "session-status",
		});
	});

	it("passes a safe, truncated tool description as an i18n parameter", () => {
		const description = "长工具描述".repeat(16);
		const event: SessionEvent = {
			...eventBase,
			type: "tool.start",
			toolCallId: "tool-1",
			toolName: "read",
			args: { description },
			startedAt: 1,
			source: "tool",
		};

		const notice = mapSessionEventToPetPresentation(event)?.bubble;
		expect(notice?.messageKey).toBe("notice.tool.runningWithDescription");
		expect(notice?.params?.description).toHaveLength(48);
		expect(notice?.params?.description).toMatch(/…$/);
		expect(notice?.dedupeKey).toBe("session-status");
	});

	it("marks errors as high-priority structured notices", () => {
		const event: SessionEvent = {
			...eventBase,
			type: "error",
			error: { code: "boom", message: "failed", retryable: false, origin: "runtime" },
		};

		expect(mapSessionEventToPetPresentation(event)?.bubble).toMatchObject({
			kind: "error",
			messageKey: "notice.error.generic",
			priority: "high",
		});
	});
});
