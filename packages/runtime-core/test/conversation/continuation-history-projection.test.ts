import type { Message } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	createEmptyConversationDocument,
	projectConversationDocumentHistory,
	selectConversationDocumentMessages,
} from "../../src/conversation/index.js";
import type { RuntimeMessageOrigin } from "../../src/runtime-execution-observation.js";

describe("conversation continuation history projection", () => {
	it("keeps internal continuations in model context without exposing them as human input", () => {
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		document = appendMessage(document, 1, {
			role: "user",
			content: "start",
			timestamp: 1,
		});
		document = appendMessage(
			document,
			2,
			{
				role: "user",
				content: "Continue the response from where you stopped.",
				timestamp: 2,
			},
			{ kind: "continuation", source: "model-length" },
		);

		expect(selectConversationDocumentMessages(document)).toHaveLength(2);
		expect(projectConversationDocumentHistory(document)).toEqual([
			expect.objectContaining({
				type: "message",
				message: expect.objectContaining({ role: "user", content: "start" }),
			}),
		]);
	});
});

function appendMessage(
	document: ConversationDocument,
	sequence: number,
	message: Message,
	origin?: RuntimeMessageOrigin,
): ConversationDocument {
	return applyStoredEventToConversationDocument(
		document,
		{
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-1",
			message,
			...(origin ? { origin } : {}),
			timestamp: sequence,
		},
		sequence,
	);
}
