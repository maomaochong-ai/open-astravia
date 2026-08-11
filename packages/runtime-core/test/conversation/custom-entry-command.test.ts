import { describe, expect, it } from "vitest";
import {
	applyConversationDocumentCommand,
	createEmptyConversationDocument,
	selectConversationDocumentEntries,
} from "../../src/conversation/index.js";

describe("conversation custom entry command", () => {
	it("appends a branch-local custom entry and advances the active leaf", () => {
		const source = createEmptyConversationDocument({
			sessionId: "session-1",
			createdAt: 1,
		});

		const result = applyConversationDocumentCommand(source, {
			type: "custom.append",
			entryId: "todo-1",
			customType: "todo_snapshot",
			data: {
				items: [{ id: 1, content: "Implement", status: "pending" }],
				lockedBy: null,
			},
			timestamp: "2026-07-28T00:00:00.000Z",
		});

		expect(result.changed).toBe(true);
		expect(result.leafId).toBe("todo-1");
		expect(result.document.revision).toBe(1);
		expect(selectConversationDocumentEntries(result.document)).toEqual([
			{
				type: "custom",
				id: "todo-1",
				parentId: null,
				timestamp: "2026-07-28T00:00:00.000Z",
				customType: "todo_snapshot",
				data: {
					items: [{ id: 1, content: "Implement", status: "pending" }],
					lockedBy: null,
				},
			},
		]);
	});

	it("rejects duplicate custom entry IDs", () => {
		const source = applyConversationDocumentCommand(
			createEmptyConversationDocument({ sessionId: "session-1", createdAt: 1 }),
			{
				type: "custom.append",
				entryId: "duplicate",
				customType: "state",
				timestamp: "2026-07-28T00:00:00.000Z",
			},
		).document;

		expect(() =>
			applyConversationDocumentCommand(source, {
				type: "custom.append",
				entryId: "duplicate",
				customType: "state",
				timestamp: "2026-07-28T00:00:01.000Z",
			}),
		).toThrow("Conversation document entry already exists: duplicate");
	});

	it("appends a label entry for an existing target", () => {
		const source = applyConversationDocumentCommand(
			createEmptyConversationDocument({ sessionId: "session-1", createdAt: 1 }),
			{
				type: "custom.append",
				entryId: "entry-1",
				customType: "state",
				timestamp: "2026-07-28T00:00:00.000Z",
			},
		).document;

		const result = applyConversationDocumentCommand(source, {
			type: "entry.label.set",
			entryId: "label-1",
			targetId: "entry-1",
			label: "Important",
			timestamp: "2026-07-28T00:00:01.000Z",
		});

		expect(result.document.entries.at(-1)).toEqual({
			type: "label",
			id: "label-1",
			parentId: "entry-1",
			targetId: "entry-1",
			label: "Important",
			timestamp: "2026-07-28T00:00:01.000Z",
		});
	});
});
