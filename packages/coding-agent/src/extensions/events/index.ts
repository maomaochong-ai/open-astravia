import type {
	AgentEndEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	ContextEvent,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ModelSelectEvent,
	ToolExecutionEndEvent,
	ToolExecutionPhaseEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "./agent-events.js";
import type { InputEvent, UserBashEvent } from "./input-events.js";
import type { ResourcesDiscoverEvent } from "./resource-events.js";
import type { SessionEvent } from "./session-events.js";
import type { ToolCallEvent, ToolResultEvent } from "./tool-events.js";

export * from "./agent-events.js";
export * from "./event-results.js";
export * from "./input-events.js";
export * from "./resource-events.js";
export * from "./session-events.js";
export * from "./tool-events.js";

/** Union of all event types */
export type ExtensionEvent =
	| ResourcesDiscoverEvent
	| SessionEvent
	| ContextEvent
	| BeforeAgentStartEvent
	| AgentStartEvent
	| AgentEndEvent
	| TurnStartEvent
	| TurnEndEvent
	| MessageStartEvent
	| MessageUpdateEvent
	| MessageEndEvent
	| ToolExecutionStartEvent
	| ToolExecutionUpdateEvent
	| ToolExecutionPhaseEvent
	| ToolExecutionEndEvent
	| ModelSelectEvent
	| UserBashEvent
	| InputEvent
	| ToolCallEvent
	| ToolResultEvent;
