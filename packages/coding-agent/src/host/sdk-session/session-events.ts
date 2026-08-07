import type { AgentMessage } from "@vetta/agent-core";
import type { RuntimeMessageEnvelope, RuntimeSessionExecutionObservation } from "@vetta/runtime-core";
import type { CustomMessage } from "../../model-context/index.js";
import type { CodingAgentSessionEvent } from "../../public-api/sdk/sdk-event-contract.js";

/** 将完整 Runtime 执行观察事件适配为现有 SDK Agent 事件。 */
export function mapCodingAgentSdkExecutionEvent(
	observation: RuntimeSessionExecutionObservation,
): CodingAgentSessionEvent {
	const { event } = observation;
	switch (event.type) {
		case "agent.start":
			return { type: "agent_start" };
		case "agent.end":
			return { type: "agent_end", messages: event.messages.map(toAgentMessage) };
		case "turn.start":
			return { type: "turn_start" };
		case "turn.end":
			return { type: "turn_end", message: event.message, toolResults: [...event.toolResults] };
		case "message.start":
			return { type: "message_start", message: toAgentMessage(event.message) };
		case "message.update":
			return {
				type: "message_update",
				message: toAgentMessage(event.message),
				assistantMessageEvent: event.assistantMessageEvent,
			};
		case "message.end":
			return { type: "message_end", message: toAgentMessage(event.message) };
		case "tool.execution.start":
			return {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				startedAt: event.startedAt,
			};
		case "tool.execution.update":
			return {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: {
					content: [...event.partialResult.content],
					details: event.partialResult.details,
				},
			};
		case "tool.execution.phase":
			return {
				type: "tool_execution_phase",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				label: event.label,
				atMs: event.atMs,
			};
		case "tool.execution.end":
			return {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: {
					content: [...event.result.content],
					details: event.result.details,
				},
				isError: event.isError,
				startedAt: event.startedAt,
				durationMs: event.durationMs,
				phases: [...event.phases],
			};
	}
}

function toAgentMessage(envelope: RuntimeMessageEnvelope): AgentMessage | CustomMessage {
	if (envelope.kind === "message") return envelope.message;
	if (envelope.kind === "opaque") {
		if (isAgentMessage(envelope.identity)) return envelope.identity;
		if (envelope.modelMessage) return envelope.modelMessage;
		throw new Error("Opaque runtime message has no Coding Agent identity");
	}
	return {
		role: "custom",
		customType: envelope.record.type,
		content: envelope.record.content,
		display: envelope.record.display ?? false,
		details: envelope.record.metadata,
		timestamp: envelope.timestamp,
	};
}

function isAgentMessage(value: unknown): value is AgentMessage {
	return (
		value !== null &&
		typeof value === "object" &&
		"role" in value &&
		typeof value.role === "string" &&
		AGENT_MESSAGE_ROLES.has(value.role)
	);
}

const AGENT_MESSAGE_ROLES = new Set([
	"user",
	"assistant",
	"toolResult",
	"bashExecution",
	"custom",
	"branchSummary",
	"compactionSummary",
]);
