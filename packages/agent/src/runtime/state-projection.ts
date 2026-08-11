import type { AgentEvent, AgentMessage, AgentState } from "../types.js";

export function projectAgentEvent(
	state: AgentState,
	event: AgentEvent,
	partial: AgentMessage | null,
): AgentMessage | null {
	switch (event.type) {
		case "message_start":
		case "message_update":
			state.streamMessage = event.message;
			return event.message;
		case "message_end":
			state.streamMessage = null;
			state.messages = [...state.messages, event.message];
			return null;
		case "tool_execution_start": {
			const pendingToolCalls = new Set(state.pendingToolCalls);
			pendingToolCalls.add(event.toolCallId);
			state.pendingToolCalls = pendingToolCalls;
			return partial;
		}
		case "tool_execution_end": {
			const pendingToolCalls = new Set(state.pendingToolCalls);
			pendingToolCalls.delete(event.toolCallId);
			state.pendingToolCalls = pendingToolCalls;
			return partial;
		}
		case "turn_end":
			if ("errorMessage" in event.message && typeof event.message.errorMessage === "string") {
				state.error = event.message.errorMessage;
			}
			return partial;
		case "agent_end":
			state.isStreaming = false;
			state.streamMessage = null;
			return partial;
		default:
			return partial;
	}
}
