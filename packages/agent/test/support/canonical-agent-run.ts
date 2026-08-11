import {
	type CanonicalAssistantEventSummary,
	canonicalizeAssistantEvents,
	canonicalizeAssistantMessage,
	canonicalizeJsonValue,
} from "@vetta/ai/testkit";
import type { AgentEvent, AgentMessage } from "../../src/types.js";

export interface CanonicalAgentRun {
	readonly lifecycle: readonly AgentEvent["type"][];
	readonly assistantEvents: CanonicalAssistantEventSummary;
	readonly checkpoints: readonly { readonly reason: string; readonly recoveryAttempt: number }[];
	readonly tools: readonly {
		readonly toolCallId: string;
		readonly toolName: string;
		readonly isError: boolean;
		readonly phases: readonly string[];
	}[];
	readonly messages: readonly unknown[];
}

export function canonicalizeAgentRun(
	events: readonly AgentEvent[],
	result: readonly AgentMessage[],
): CanonicalAgentRun {
	const assistantEvents = events.flatMap((event) =>
		event.type === "message_update" ? [event.assistantMessageEvent] : [],
	);
	return {
		lifecycle: events.flatMap((event) =>
			event.type === "message_update" || event.type === "tool_execution_update" ? [] : [event.type],
		),
		assistantEvents: canonicalizeAssistantEvents(assistantEvents),
		checkpoints: events.flatMap((event) =>
			event.type === "context_checkpoint"
				? [{ reason: event.request.reason, recoveryAttempt: event.request.recoveryAttempt }]
				: [],
		),
		tools: events.flatMap((event) =>
			event.type === "tool_execution_end"
				? [
						{
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							isError: event.isError,
							phases: event.phases.map(({ label }) => label),
						},
					]
				: [],
		),
		messages: result.map(canonicalizeAgentMessage),
	};
}

function canonicalizeAgentMessage(message: AgentMessage): unknown {
	if (message.role === "assistant") return canonicalizeAssistantMessage(message);
	if (message.role === "user") {
		return {
			role: message.role,
			content: canonicalizeJsonValue(message.content),
		};
	}
	if (message.role === "toolResult") {
		return {
			role: message.role,
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: canonicalizeJsonValue(message.content),
			details: canonicalizeJsonValue(message.details),
			isError: message.isError,
		};
	}
	return canonicalizeJsonValue(message);
}
