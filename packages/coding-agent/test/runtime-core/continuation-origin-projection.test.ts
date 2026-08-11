import type { UserMessage } from "@vetta/ai";
import {
	applyStoredEventToConversationDocument,
	createEmptyConversationDocument,
} from "@vetta/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import { CodingAgentConversationContextProjector } from "../../src/sessions/projection/conversation-context-projector.js";

describe("continuation message origin projection", () => {
	it("restores persisted continuation origin while treating legacy messages as human input", () => {
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: user("todo continuation", 1),
				origin: { kind: "continuation", source: "todo" },
				timestamp: 1,
			},
			1,
		);
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-2",
				message: user("human input", 2),
				timestamp: 2,
			},
			2,
		);

		const envelopes = new CodingAgentConversationContextProjector().project(document);

		expect(envelopes).toMatchObject([
			{ kind: "message", origin: { kind: "continuation", source: "todo" } },
			{ kind: "message" },
		]);
		expect(envelopes[1]).not.toHaveProperty("origin");
	});
});

function user(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
}
