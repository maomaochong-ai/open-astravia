import type { AssistantMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { projectAgentEvent } from "../src/runtime/state-projection.js";
import type { AgentMessage, AgentState } from "../src/types.js";

function createState(): AgentState {
	return {
		systemPrompt: "",
		thinkingLevel: "off",
		tools: [],
		messages: [],
		isStreaming: true,
		streamMessage: null,
		pendingToolCalls: new Set(),
	};
}

function assistant(errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: errorMessage ? "" : "done" }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: errorMessage ? "error" : "stop",
		errorMessage,
		timestamp: 1,
	};
}

describe("projectAgentEvent", () => {
	it("projects message lifecycle into streaming and persisted state", () => {
		const state = createState();
		const message = assistant();

		let partial = projectAgentEvent(state, { type: "message_start", message }, null);
		expect(partial).toBe(message);
		expect(state.streamMessage).toBe(message);

		partial = projectAgentEvent(state, { type: "message_end", message }, partial);
		expect(partial).toBeNull();
		expect(state.streamMessage).toBeNull();
		expect(state.messages).toEqual([message]);
	});

	it("tracks pending tool calls without mutating previous sets", () => {
		const state = createState();
		const before = state.pendingToolCalls;
		const partial: AgentMessage = assistant();

		expect(
			projectAgentEvent(
				state,
				{ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: {}, startedAt: 1 },
				partial,
			),
		).toBe(partial);
		expect(state.pendingToolCalls).not.toBe(before);
		expect(state.pendingToolCalls).toEqual(new Set(["call-1"]));

		projectAgentEvent(
			state,
			{
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "read",
				result: { content: [], details: {} },
				isError: false,
				startedAt: 1,
				durationMs: 1,
				phases: [],
			},
			partial,
		);
		expect(state.pendingToolCalls).toEqual(new Set());
	});

	it("projects assistant errors and the terminal agent state", () => {
		const state = createState();
		const message = assistant("provider failed");

		projectAgentEvent(state, { type: "turn_end", message, toolResults: [] }, message);
		expect(state.error).toBe("provider failed");

		projectAgentEvent(state, { type: "agent_end", messages: [message] }, message);
		expect(state.isStreaming).toBe(false);
		expect(state.streamMessage).toBeNull();
	});
});
