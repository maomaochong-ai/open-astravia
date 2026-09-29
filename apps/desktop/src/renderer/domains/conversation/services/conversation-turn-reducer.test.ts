import { createConversationUserMessage } from "@shared/conversation";
import type { ConversationMessageAppendedEvent, ConversationTurnEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import {
	commitConversationUserMessage,
	finishConversationTurn,
	startConversationTurn,
} from "./conversation-turn-reducer";

function committedUser(turnId: string, messageId: string, text: string): ConversationMessageAppendedEvent {
	return {
		type: "conversation.message.appended",
		schemaVersion: 1,
		channel: "runtime",
		source: "runtime-core",
		sessionId: "session-1",
		eventId: `event-${messageId}`,
		timestamp: 2,
		turnId,
		messageId,
		message: { role: "user", content: text, timestamp: 2 },
	};
}

function cancelled(
	turnId: string,
	timestamp: number,
): Extract<ConversationTurnEvent, { readonly type: "conversation.turn.cancelled" }> {
	return {
		type: "conversation.turn.cancelled",
		schemaVersion: 1,
		channel: "runtime",
		source: "runtime-core",
		sessionId: "session-1",
		eventId: `cancel-${turnId}`,
		timestamp,
		turnId,
	};
}

describe("conversation Turn reducer", () => {
	it("uses the durable user identity instead of queue disappearance or text matching", () => {
		const optimistic = createConversationUserMessage({
			id: "user-1",
			deliveryPhase: "pending",
			text: "same text",
		});
		const withDraft = startConversationTurn([optimistic], "turn-1", "assistant:turn-1:0", 1);
		const committed = commitConversationUserMessage(
			withDraft,
			committedUser("turn-1", "user-1", "same text"),
			"assistant:turn-1:1",
		);

		expect(committed).toHaveLength(2);
		expect(committed[0]).toMatchObject({
			kind: "user",
			id: "user-1",
			entryId: "user-1",
			turnId: "turn-1",
			deliveryPhase: "completed",
		});
		expect(committed[1]).toMatchObject({
			kind: "agent",
			id: "assistant:turn-1:1",
			turnId: "turn-1",
			phase: "streaming",
		});
	});

	it("a late terminal event for Turn A never settles Turn B", () => {
		let messages = startConversationTurn([], "turn-a", "assistant:turn-a:0", 1);
		messages = commitConversationUserMessage(messages, committedUser("turn-a", "user-a", "A"), "assistant:turn-a:1");
		messages = startConversationTurn(messages, "turn-b", "assistant:turn-b:0", 3);
		messages = commitConversationUserMessage(messages, committedUser("turn-b", "user-b", "B"), "assistant:turn-b:1");

		const settled = finishConversationTurn(messages, cancelled("turn-a", 4));
		expect(settled.find((item) => item.kind === "agent" && item.turnId === "turn-a")).toMatchObject({
			phase: "aborted",
		});
		const turnB = settled.find((item) => item.kind === "agent" && item.turnId === "turn-b");
		expect(turnB).toMatchObject({ phase: "streaming" });
		expect(turnB).not.toHaveProperty("endedAt");
	});

	it("finishes the previous segment before a steering message and settles only the latest segment", () => {
		let messages = startConversationTurn([], "turn-1", "assistant:turn-1:0", 1);
		messages = commitConversationUserMessage(
			messages,
			committedUser("turn-1", "user-1", "first"),
			"assistant:turn-1:1",
		);
		messages = messages.map((item) =>
			item.kind === "agent"
				? { ...item, text: "first answer", blocks: [{ type: "text", id: "b-1", text: "first answer" }] }
				: item,
		);
		messages = commitConversationUserMessage(
			messages,
			{ ...committedUser("turn-1", "user-2", "steer"), timestamp: 3 },
			"assistant:turn-1:2",
		);

		expect(messages).toMatchObject([
			{ kind: "user", id: "user-1" },
			{ kind: "agent", id: "assistant:turn-1:1", phase: "completed", endedAt: 3 },
			{ kind: "user", id: "user-2" },
			{ kind: "agent", id: "assistant:turn-1:2", phase: "streaming" },
		]);

		const settled = finishConversationTurn(messages, cancelled("turn-1", 4));
		expect(settled[1]).toMatchObject({ phase: "completed", endedAt: 3 });
		expect(settled[3]).toMatchObject({ phase: "aborted", endedAt: 4 });
	});
});
