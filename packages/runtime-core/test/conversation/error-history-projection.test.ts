import { describe, expect, it } from "vitest";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	createEmptyConversationDocument,
	projectConversationDocumentHistory,
	selectConversationDocumentMessages,
} from "../../src/conversation/index.js";

describe("conversation error history projection", () => {
	it("keeps turn.failed visible in host history without adding it to model messages", () => {
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: { role: "user", content: "hello", timestamp: 1 },
				timestamp: 1,
			},
			1,
		);
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "turn.failed",
				sessionId: "session-1",
				turnId: "turn-1",
				error: { code: "TRANSPORT_FAILED", message: "503 service unavailable" },
				timestamp: 2,
			},
			2,
		);

		expect(projectConversationDocumentHistory(document)).toEqual([
			expect.objectContaining({ type: "message", message: expect.objectContaining({ role: "user" }) }),
			{
				type: "error",
				entryId: "event-2",
				code: "TRANSPORT_FAILED",
				message: "503 service unavailable",
				timestamp: new Date(2).toISOString(),
			},
		]);
		expect(selectConversationDocumentMessages(document)).toHaveLength(1);
		expect(document.revision).toBe(1);

		const commandResult = applyConversationDocumentCommand(document, {
			type: "custom.append",
			entryId: "after-failure",
			customType: "metadata",
			timestamp: "2026-08-13T00:00:00.000Z",
		});
		expect(commandResult.document.revision).toBe(2);
		expect(commandResult.document.entries.at(-1)?.parentId).toBe("event-2");
	});

	it("projects a rejected prompt as the attempted user input followed by its error", () => {
		const initial = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		const { document } = applyConversationDocumentCommand(initial, {
			type: "custom.append",
			entryId: "rejected-1",
			customType: "prompt_rejected",
			data: { text: "hello", error: "Model is not configured" },
			timestamp: "2026-08-13T00:00:00.000Z",
		});

		expect(projectConversationDocumentHistory(document)).toEqual([
			{
				type: "message",
				message: { role: "user", content: "hello", timestamp: Date.parse("2026-08-13T00:00:00.000Z") },
			},
			{
				type: "error",
				entryId: "rejected-1",
				message: "Model is not configured",
				timestamp: "2026-08-13T00:00:00.000Z",
			},
		]);
	});
});
