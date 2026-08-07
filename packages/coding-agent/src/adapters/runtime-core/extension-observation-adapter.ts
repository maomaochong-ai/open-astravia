import type { AgentMessage } from "@vetta/agent-core";
import type { RuntimeMessageEnvelope, RuntimeSessionExecutionObservation } from "@vetta/runtime-core";
import type {
	AgentEndEvent,
	AgentStartEvent,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionPhaseEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "../../extensions/index.js";
import type { CustomMessage } from "../../model-context/index.js";

export type CodingAgentObservedExtensionEvent =
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
	| ToolExecutionEndEvent;

/**
 * 将产品无关的 Runtime 执行观察事件适配为旧 Extension 观察事件。
 *
 * turnIndex 保持 Legacy EventRouter 的 Agent Run 级语义：agent_start 归零，
 * 每个 turn_end 完成后递增。
 */
export class CodingAgentExtensionObservationAdapter {
	private turnIndex = 0;

	constructor(private readonly emit: (event: CodingAgentObservedExtensionEvent) => Promise<void>) {}

	async observe(observation: RuntimeSessionExecutionObservation): Promise<void> {
		const { event } = observation;
		if (event.type === "agent.start") {
			this.turnIndex = 0;
			await this.emit({ type: "agent_start" });
			return;
		}
		if (event.type === "agent.end") {
			await this.emit({ type: "agent_end", messages: event.messages.map(toAgentMessage) });
			return;
		}
		if (event.type === "turn.start") {
			await this.emit({
				type: "turn_start",
				turnIndex: this.turnIndex,
				timestamp: observation.timestamp,
			});
			return;
		}
		if (event.type === "turn.end") {
			try {
				await this.emit({
					type: "turn_end",
					turnIndex: this.turnIndex,
					message: event.message,
					toolResults: [...event.toolResults],
				});
			} finally {
				this.turnIndex++;
			}
			return;
		}
		if (event.type === "message.start") {
			await this.emit({ type: "message_start", message: toAgentMessage(event.message) });
			return;
		}
		if (event.type === "message.update") {
			await this.emit({
				type: "message_update",
				message: toAgentMessage(event.message),
				assistantMessageEvent: event.assistantMessageEvent,
			});
			return;
		}
		if (event.type === "message.end") {
			await this.emit({ type: "message_end", message: toAgentMessage(event.message) });
			return;
		}
		if (event.type === "tool.execution.start") {
			await this.emit({
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				startedAt: event.startedAt,
			});
			return;
		}
		if (event.type === "tool.execution.update") {
			await this.emit({
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: {
					content: [...event.partialResult.content],
					details: event.partialResult.details,
				},
			});
			return;
		}
		if (event.type === "tool.execution.phase") {
			await this.emit({
				type: "tool_execution_phase",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				label: event.label,
				atMs: event.atMs,
			});
			return;
		}
		await this.emit({
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
		});
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
