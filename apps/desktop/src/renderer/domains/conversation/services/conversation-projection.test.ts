import type { AssistantMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { projectConversationAgentMessage } from "./conversation-projection";

describe("projectConversationAgentMessage", () => {
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

	it("projects a failed persisted assistant and settles unfinished tools as errors", () => {
		const message = {
			...({ role: "assistant" } as AssistantMessage),
			stopReason: "error",
			content: [
				{ type: "text", text: "partial" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
			],
		} as AssistantMessage;

		const projected = projectConversationAgentMessage({ message, messageId: "failed-message" });

		expect(projected).toMatchObject({
			kind: "agent",
			phase: "failed",
			text: "partial",
			blocks: expect.arrayContaining([
				expect.objectContaining({ type: "tool_call", toolCallId: "call-1", status: "error" }),
			]),
		});
	});
});
