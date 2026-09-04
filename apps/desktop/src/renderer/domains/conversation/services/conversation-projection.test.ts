import type { AssistantMessage, AssistantMessageEvent } from "@vetta/ai";
import type { AssistantSessionEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { ConversationProjection, projectConversationAgentMessage } from "./conversation-projection";

function envelope(event: AssistantMessageEvent, sequence: number): AssistantSessionEvent {
	return {
		schemaVersion: 1,
		sessionId: "session-1",
		eventId: `event-${sequence}`,
		timestamp: sequence,
		source: "agent",
		sequence,
		channel: "assistant",
		turnId: "turn-1",
		modelCallIndex: 0,
		...event,
	};
}

describe("ConversationProjection", () => {
	it("projects persisted assistant content and execution metadata through the shared block model", () => {
		const message = {
			role: "assistant",
			content: [
				{ type: "text", text: "before" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
				{ type: "text", text: "after" },
			],
		} as unknown as AssistantMessage;
		const projected = projectConversationAgentMessage({
			message,
			messageId: "message-1",
			executions: [
				{
					messageId: "message-1",
					toolCallId: "call-1",
					toolName: "read",
					args: { path: "README.md" },
					result: { content: [{ type: "text", text: "contents" }] },
					isError: false,
				},
			],
		});

		expect(projected.kind).toBe("agent");
		if (projected.kind !== "agent") return;
		expect(projected.blocks.map((block) => block.type)).toEqual(["text", "tool_call", "text"]);
		expect(projected.blocks[1]).toMatchObject({
			type: "tool_call",
			toolCallId: "call-1",
			status: "success",
			result: "contents",
		});
	});

	it("keeps interleaved thinking, text, and tool events in wire order", () => {
		const projection = new ConversationProjection();
		const partial = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "r" },
				{ type: "text", text: "a" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
			],
		} as unknown as AssistantMessage;
		const events: AssistantMessageEvent[] = [
			{ type: "thinking_delta", contentIndex: 0, delta: "r", partial },
			{ type: "text_delta", contentIndex: 1, delta: "a", partial },
			{ type: "toolcall_start", contentIndex: 2, partial },
			{ type: "text_delta", contentIndex: 1, delta: "b", partial },
		];
		for (let index = 0; index < events.length; index += 1) projection.enqueue(envelope(events[index], index + 1));

		const messages = projection.flush([]);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			kind: "agent",
			text: "ab",
			blocks: [
				expect.objectContaining({ type: "thinking" }),
				expect.objectContaining({ type: "text" }),
				expect.objectContaining({ type: "tool_call" }),
				expect.objectContaining({ type: "text" }),
			],
		});
	});

	it("deduplicates replayed events by the host sequence", () => {
		const projection = new ConversationProjection();
		const partial = { role: "assistant", content: [{ type: "text", text: "a" }] } as unknown as AssistantMessage;
		const event = envelope({ type: "text_delta", contentIndex: 0, delta: "a", partial }, 1);
		projection.enqueue(event);
		projection.enqueue(event);

		expect(projection.flush([])[0]).toMatchObject({ kind: "agent", text: "a" });
	});
});
