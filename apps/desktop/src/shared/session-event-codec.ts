import type { SessionEvent } from "@vetta/runtime-core";

const SESSION_EVENT_TYPES = new Set([
	"session.lifecycle",
	"session.path_changed",
	"message.delta",
	"thinking.delta",
	"message.final",
	"toolcall.start",
	"toolcall.args",
	"tool.start",
	"tool.update",
	"tool.phase",
	"tool.end",
	"usage.update",
	"error",
	"session.extension",
	"active_tools_update",
	"compaction.start",
	"compaction.end",
	"retry.start",
	"retry.end",
	"queue.changed",
]);

const ASSISTANT_EVENT_TYPES = new Set([
	"start",
	"text_start",
	"text_delta",
	"text_end",
	"thinking_start",
	"thinking_delta",
	"thinking_end",
	"toolcall_start",
	"toolcall_delta",
	"toolcall_end",
	"done",
	"error",
]);

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function fail(reason: string): never {
	throw new TypeError(`Invalid SessionEvent IPC payload: ${reason}`);
}

function validateAssistantEvent(value: unknown): void {
	const event = record(value);
	if (!event || typeof event.type !== "string" || !ASSISTANT_EVENT_TYPES.has(event.type)) {
		fail("unknown assistant event type");
	}
	if (event.type === "done") {
		if (!record(event.message) || typeof event.reason !== "string") fail("invalid assistant done event");
		return;
	}
	if (event.type === "error") {
		if (!record(event.error) || typeof event.reason !== "string") fail("invalid assistant error event");
		if (event.failure !== undefined && !record(event.failure)) fail("invalid assistant failure");
		return;
	}
	if (!record(event.partial)) fail("assistant partial is missing");
	if (event.type === "start") return;
	if (!Number.isInteger(event.contentIndex) || Number(event.contentIndex) < 0) fail("invalid assistant contentIndex");
	if (
		(event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") &&
		typeof event.delta !== "string"
	) {
		fail("assistant delta is missing");
	}
	if ((event.type === "text_end" || event.type === "thinking_end") && typeof event.content !== "string") {
		fail("assistant final content is missing");
	}
	if (event.type === "toolcall_end" && !record(event.toolCall)) fail("assistant toolCall is missing");
}

/** Runtime validation for the untrusted main → preload → renderer boundary. */
export function decodeSessionEvent(value: unknown): SessionEvent {
	const event = record(value);
	if (!event) fail("payload is not an object");
	if (event.schemaVersion !== 1) fail("unsupported schemaVersion");
	if (typeof event.sessionId !== "string" || event.sessionId.length === 0) fail("sessionId is missing");
	if (typeof event.eventId !== "string" || event.eventId.length === 0) fail("eventId is missing");
	if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp)) fail("timestamp is invalid");
	if (typeof event.source !== "string") fail("source is missing");
	if (event.sequence !== undefined && (!Number.isInteger(event.sequence) || Number(event.sequence) < 1)) {
		fail("sequence is invalid");
	}
	if (event.channel === "assistant") {
		if (event.source !== "agent") fail("assistant source is invalid");
		if (!Number.isInteger(event.modelCallIndex) || Number(event.modelCallIndex) < 0) {
			fail("modelCallIndex is invalid");
		}
		if (event.turnId !== undefined && typeof event.turnId !== "string") fail("turnId is invalid");
		validateAssistantEvent(event);
		return event as unknown as SessionEvent;
	}
	if (event.channel !== undefined && event.channel !== "runtime") fail("runtime channel is invalid");
	if (typeof event.type !== "string" || !SESSION_EVENT_TYPES.has(event.type)) fail("unknown event type");
	return event as unknown as SessionEvent;
}
