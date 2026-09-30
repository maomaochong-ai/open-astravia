import type { SessionEvent } from "@vetta/runtime-core";

type RuntimeSessionEventType = Exclude<SessionEvent, { readonly channel: "assistant" }>["type"];

/**
 * Where a Runtime event goes in the renderer:
 * - `conversation-feed`: the message list reducer (ADR-0146);
 * - `session-state`: session-wide atoms such as context usage, queue and extensions;
 * - `ignored`: deliberately not consumed by the chat view.
 */
export type SessionEventRoute = "conversation-feed" | "session-state" | "ignored";

/**
 * Exhaustive by construction: a new event type in the Runtime contract fails to
 * compile here until someone decides who handles it, so no event is dropped by
 * accident and no branch waits for an event that no longer exists.
 */
const RUNTIME_EVENT_ROUTES = {
	"conversation.turn.started": "conversation-feed",
	"conversation.turn.completed": "conversation-feed",
	"conversation.turn.cancelled": "conversation-feed",
	"conversation.turn.failed": "conversation-feed",
	"conversation.message.appended": "conversation-feed",
	"model.request.started": "conversation-feed",
	"tool.start": "conversation-feed",
	"tool.phase": "conversation-feed",
	"tool.end": "conversation-feed",
	error: "conversation-feed",
	"session.context.state": "session-state",
	"usage.update": "session-state",
	"queue.changed": "session-state",
	"retry.start": "session-state",
	"retry.end": "session-state",
	"compaction.start": "session-state",
	"compaction.end": "session-state",
	active_tools_update: "session-state",
	"session.extension": "session-state",
	// Streaming state follows conversation.turn.* facts; the lifecycle is kept for other hosts.
	"session.lifecycle": "ignored",
	// The durable path is adopted from session.create and history, not from this notice.
	"session.path_changed": "ignored",
	// Partial tool results are not rendered; tool.end carries the complete result.
	"tool.update": "ignored",
} as const satisfies Record<RuntimeSessionEventType, SessionEventRoute>;

export function routeSessionEvent(event: SessionEvent): SessionEventRoute {
	if (event.channel === "assistant") return "conversation-feed";
	return RUNTIME_EVENT_ROUTES[event.type];
}
