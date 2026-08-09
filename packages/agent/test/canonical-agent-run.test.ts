import type { AssistantMessageEvent } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/types.js";
import { createAssistantMessage } from "./support/agent-loop-fixtures.js";
import { canonicalizeAgentRun } from "./support/canonical-agent-run.js";

function events(deltas: readonly string[], startedAt: number, durationMs: number): AgentEvent[] {
	const result = createAssistantMessage([{ type: "text", text: "hello" }]);
	const partial = { ...result, content: [{ type: "text" as const, text: "" }] };
	const updates: AssistantMessageEvent[] = deltas.map((delta) => ({
		type: "text_delta",
		contentIndex: 0,
		delta,
		partial,
	}));
	return [
		{ type: "agent_start" },
		{ type: "turn_start" },
		...updates.map((assistantMessageEvent) => ({
			type: "message_update" as const,
			message: partial,
			assistantMessageEvent,
		})),
		{
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "search",
			result: { content: [] },
			isError: false,
			startedAt,
			durationMs,
			phases: [
				{ label: "prepare", atMs: 1 },
				{ label: "execute", atMs: durationMs },
			],
		},
		{ type: "message_end", message: result },
		{ type: "turn_end", message: result, toolResults: [] },
		{ type: "agent_end", messages: [result] },
	];
}

describe("canonical agent run", () => {
	it("ignores delta chunking and timing while retaining semantic lifecycle", () => {
		const leftMessage = createAssistantMessage([{ type: "text", text: "hello" }]);
		const rightMessage = { ...leftMessage, timestamp: leftMessage.timestamp + 1000 };
		const left = canonicalizeAgentRun(events(["hel", "lo"], 10, 20), [leftMessage]);
		const right = canonicalizeAgentRun(events(["hello"], 1000, 9000), [rightMessage]);

		expect(left).toEqual(right);
		expect(left).toMatchObject({
			lifecycle: ["agent_start", "turn_start", "tool_execution_end", "message_end", "turn_end", "agent_end"],
			assistantEvents: { text: [{ contentIndex: 0, value: "hello" }] },
			tools: [{ toolCallId: "call-1", toolName: "search", isError: false, phases: ["prepare", "execute"] }],
		});
	});
});
