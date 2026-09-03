import { createAssistantMessage } from "@vetta/ai";
import type { ConversationAgentMessageEvent } from "@vetta/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import { reduceConversationMessageEvent } from "./message-stream";

function textEvent(input: {
	readonly conversationId: string;
	readonly messageId: string;
	readonly authorId: string;
	readonly sequence: number;
	readonly delta: string;
}): ConversationAgentMessageEvent {
	const partial = {
		...createAssistantMessage(
			{ api: "message-stream-test", provider: "message-stream-test", model: "fixture" },
			{ timestamp: input.sequence },
		),
		content: [{ type: "text" as const, text: input.delta }],
	};
	return {
		type: "conversation.agent-message-event",
		conversationId: input.conversationId,
		messageId: input.messageId,
		turnId: "request",
		author: { kind: "agent", id: input.authorId },
		sequence: input.sequence,
		timestamp: input.sequence,
		event: { type: "text_delta", contentIndex: 0, delta: input.delta, partial },
	};
}

describe("reduceConversationMessageEvent", () => {
	it("keeps identity, author, role fields, and ordered deltas in one strict Agent message", () => {
		const first = reduceConversationMessageEvent(
			undefined,
			textEvent({
				conversationId: "conversation",
				messageId: "message",
				authorId: "reviewer",
				sequence: 1,
				delta: "a",
			}),
		);
		const second = reduceConversationMessageEvent(
			first,
			textEvent({
				conversationId: "conversation",
				messageId: "message",
				authorId: "reviewer",
				sequence: 2,
				delta: "b",
			}),
		);
		expect(second).toMatchObject({
			conversationId: "conversation",
			sequence: 2,
			message: {
				id: "message",
				turnId: "request",
				authorId: "reviewer",
				kind: "agent",
				role: "assistant",
				phase: "streaming",
				text: "ab",
			},
		});
	});

	it("ignores replayed sequence numbers and rejects cross-message state reuse", () => {
		const firstEvent = textEvent({
			conversationId: "conversation",
			messageId: "message",
			authorId: "reviewer",
			sequence: 1,
			delta: "a",
		});
		const state = reduceConversationMessageEvent(undefined, firstEvent);
		expect(reduceConversationMessageEvent(state, firstEvent)).toBe(state);
		expect(() =>
			reduceConversationMessageEvent(
				state,
				textEvent({
					conversationId: "conversation",
					messageId: "other",
					authorId: "builder",
					sequence: 2,
					delta: "b",
				}),
			),
		).toThrow("does not match");
	});

	it.each([
		["done", "completed"],
		["error", "failed"],
		["aborted", "aborted"],
	] as const)("projects a %s terminal event to the message-owned %s phase", (terminal, phase) => {
		const initial = reduceConversationMessageEvent(
			undefined,
			textEvent({
				conversationId: "conversation",
				messageId: `message-${terminal}`,
				authorId: "reviewer",
				sequence: 1,
				delta: "result",
			}),
		);
		const message = {
			...createAssistantMessage(
				{ api: "message-stream-test", provider: "message-stream-test", model: "fixture" },
				{ timestamp: 1_001, stopReason: terminal === "done" ? "stop" : terminal },
			),
			content: [{ type: "text" as const, text: "result" }],
		};
		const event: ConversationAgentMessageEvent = {
			...textEvent({
				conversationId: "conversation",
				messageId: `message-${terminal}`,
				authorId: "reviewer",
				sequence: 2,
				delta: "",
			}),
			event:
				terminal === "done"
					? { type: "done", reason: "stop", message }
					: { type: "error", reason: terminal, error: message },
		};

		expect(reduceConversationMessageEvent(initial, event).message).toMatchObject({
			phase,
			endedAt: 1_001,
			durationSeconds: 1,
		});
	});
});
