import type { AssistantMessageEvent } from "@vetta/ai";
import type { SessionEvent } from "@vetta/runtime-core";

type RuntimeSessionEventType = Exclude<SessionEvent, { readonly channel: "assistant" }>["type"];

/**
 * Exhaustive by construction: `satisfies Record<…>` fails to compile when the
 * contract gains or loses an event type, so this allowlist cannot drift.
 */
const RUNTIME_EVENT_TYPES = {
	"session.lifecycle": true,
	"conversation.turn.started": true,
	"conversation.turn.completed": true,
	"conversation.turn.cancelled": true,
	"conversation.turn.failed": true,
	"conversation.message.appended": true,
	"model.request.started": true,
	"session.path_changed": true,
	"tool.start": true,
	"tool.update": true,
	"tool.phase": true,
	"tool.end": true,
	"usage.update": true,
	error: true,
	"session.extension": true,
	active_tools_update: true,
	"compaction.start": true,
	"compaction.end": true,
	"retry.start": true,
	"retry.end": true,
	"queue.changed": true,
	"session.context.state": true,
} satisfies Record<RuntimeSessionEventType, true>;

const ASSISTANT_EVENT_TYPE_KEYS = {
	start: true,
	text_start: true,
	text_delta: true,
	text_end: true,
	thinking_start: true,
	thinking_delta: true,
	thinking_end: true,
	toolcall_start: true,
	toolcall_delta: true,
	toolcall_end: true,
	done: true,
	error: true,
} satisfies Record<AssistantMessageEvent["type"], true>;

const SESSION_EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(RUNTIME_EVENT_TYPES));
const ASSISTANT_EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(ASSISTANT_EVENT_TYPE_KEYS));

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
	if (event.type === "model.request.started") {
		if (typeof event.turnId !== "string" || event.turnId.length === 0) fail("request turnId is missing");
		if (!Number.isInteger(event.modelCallIndex) || Number(event.modelCallIndex) < 0)
			fail("request modelCallIndex is invalid");
	}
	if (event.type.startsWith("conversation.turn.")) {
		if (typeof event.turnId !== "string" || event.turnId.length === 0) fail("conversation turnId is missing");
		if (event.type === "conversation.turn.completed" && typeof event.stopReason !== "string") {
			fail("conversation stopReason is missing");
		}
		if (
			event.type === "conversation.turn.cancelled" &&
			event.reason !== undefined &&
			typeof event.reason !== "string"
		) {
			fail("conversation cancellation reason is invalid");
		}
		if (event.type === "conversation.turn.failed" && !record(event.error)) {
			fail("conversation failure is missing");
		}
	}
	if (event.type === "conversation.message.appended") {
		if (typeof event.turnId !== "string" || event.turnId.length === 0) fail("conversation turnId is missing");
		if (typeof event.messageId !== "string" || event.messageId.length === 0)
			fail("conversation messageId is missing");
		if (!record(event.message)) fail("conversation message is missing");
	}
	if (event.type === "session.context.state") {
		const state = record(event.state);
		if (!state || state.sessionId !== event.sessionId || !Number.isInteger(state.revision)) {
			fail("invalid session context state");
		}
		const usage = record(state.usage);
		const compaction = record(state.compaction);
		if (!usage || !compaction || typeof compaction.status !== "string" || !record(compaction.eligibility)) {
			fail("invalid session context state payload");
		}
	}
	return event as unknown as SessionEvent;
}
