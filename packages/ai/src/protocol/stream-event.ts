import { AIStreamProtocolError } from "./errors.js";
import type { FailedStopReason, SuccessfulStopReason } from "./finish-reason.js";
import type { AssistantMessage } from "./message.js";
import type { ToolCall } from "./tool.js";

export type AssistantMessageEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| AssistantMessageDoneEvent
	| AssistantMessageErrorEvent;

export interface AssistantMessageDoneEvent {
	type: "done";
	reason: SuccessfulStopReason;
	message: AssistantMessage;
}

export interface AssistantMessageErrorEvent {
	type: "error";
	reason: FailedStopReason;
	error: AssistantMessage;
}

export type AssistantMessageTerminalEvent = AssistantMessageDoneEvent | AssistantMessageErrorEvent;

export function isAssistantMessageTerminalEvent(event: AssistantMessageEvent): event is AssistantMessageTerminalEvent {
	return event.type === "done" || event.type === "error";
}

export function getAssistantMessageEventResult(event: AssistantMessageEvent): AssistantMessage {
	if (event.type === "done") return event.message;
	if (event.type === "error") return event.error;
	throw new AIStreamProtocolError(`Expected a terminal assistant message event, received: ${event.type}`, {
		metadata: { eventType: event.type },
	});
}
