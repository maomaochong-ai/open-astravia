import {
	type ConversationDocument,
	createEmptyConversationDocument,
	selectConversationDocumentEntries,
	selectConversationDocumentModelMessages,
} from "@vetta/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import { projectPinnedConversationDocument } from "../../../src/compaction/runtime/pinned-conversation-projection.js";
import { requireCodingAgentPinnedModelContext } from "../../../src/compaction/runtime/pinned-model-context-projection.js";

describe("pinned conversation projection", () => {
	it("preserves the private tail when an earlier compaction boundary points at an omitted import", () => {
		const document: ConversationDocument = {
			...createEmptyConversationDocument({ sessionId: "member", createdAt: 1 }),
			activeLeafId: "compaction",
			entries: [
				{
					id: "old-import",
					parentId: null,
					type: "custom_message",
					customType: "shared",
					content: "old public",
					display: false,
					timestamp: new Date(1).toISOString(),
				},
				{
					id: "already-summarized",
					parentId: "old-import",
					type: "message",
					message: { role: "user", content: "already summarized", timestamp: 2 },
					timestamp: new Date(2).toISOString(),
				},
				{
					id: "import",
					parentId: "already-summarized",
					type: "custom_message",
					customType: "shared",
					content: "public",
					display: false,
					timestamp: new Date(3).toISOString(),
				},
				{
					id: "tail",
					parentId: "import",
					type: "message",
					message: { role: "user", content: "private tail", timestamp: 4 },
					timestamp: new Date(4).toISOString(),
				},
				{
					id: "compaction",
					parentId: "tail",
					type: "compaction",
					summary: "summary",
					summaryMessage: { role: "user", content: "summary", timestamp: 5 },
					firstKeptEntryId: "import",
					tokensBefore: 100,
					timestamp: new Date(5).toISOString(),
				},
			],
		};
		const projected = projectPinnedConversationDocument(document, {
			id: "generation",
			records: [],
			conversationProjections: [
				{ entryId: "old-import", kind: "omit-entry" },
				{ entryId: "import", kind: "omit-entry" },
			],
		});
		expect(selectConversationDocumentModelMessages(projected).map(({ content }) => content)).toEqual([
			"summary",
			"private tail",
		]);
		expect(document.entries.at(-1)).toMatchObject({ firstKeptEntryId: "import" });
	});

	it("reparents the model-only branch and active leaf without editing the stored document", () => {
		const document: ConversationDocument = {
			...createEmptyConversationDocument({ sessionId: "member", createdAt: 1 }),
			activeLeafId: "last-import",
			entries: [
				{
					id: "root",
					parentId: null,
					type: "message",
					message: { role: "user", content: "private", timestamp: 1 },
					timestamp: new Date(1).toISOString(),
				},
				{
					id: "import",
					parentId: "root",
					type: "custom_message",
					customType: "shared",
					content: "public",
					display: false,
					timestamp: new Date(2).toISOString(),
				},
				{
					id: "tail",
					parentId: "import",
					type: "message",
					message: { role: "user", content: "current", timestamp: 3 },
					timestamp: new Date(3).toISOString(),
				},
				{
					id: "last-import",
					parentId: "tail",
					type: "custom_message",
					customType: "shared",
					content: "public",
					display: false,
					timestamp: new Date(4).toISOString(),
				},
			],
		};
		const before = structuredClone(document);
		const projected = projectPinnedConversationDocument(document, {
			id: "generation",
			records: [],
			conversationProjections: [
				{ entryId: "import", kind: "omit-entry" },
				{ entryId: "last-import", kind: "omit-entry" },
			],
		});
		expect(projected.activeLeafId).toBe("tail");
		expect(selectConversationDocumentEntries(projected).map(({ id, parentId }) => ({ id, parentId }))).toEqual([
			{ id: "root", parentId: null },
			{ id: "tail", parentId: "root" },
		]);
		expect(document).toEqual(before);
	});

	it.each(
		[
			[{ entryId: "entry", kind: "unknown" }],
			[{ entryId: "", kind: "omit-entry" }],
			[
				{ entryId: "entry", kind: "omit-entry" },
				{ entryId: "entry", kind: "omit-assistant-text" },
			],
		].map((conversationProjections) => ({ conversationProjections })),
	)(
		"rejects ambiguous or invalid host projections before they can change model input",
		({ conversationProjections }) => {
			expect(() =>
				requireCodingAgentPinnedModelContext({ id: "generation", records: [], conversationProjections }),
			).toThrow("invalid or duplicate conversation projection");
		},
	);

	it("captures projection instructions independently of later host mutation", () => {
		const projection = { entryId: "entry", kind: "omit-entry" };
		const pinned = requireCodingAgentPinnedModelContext({
			id: "generation",
			records: [],
			conversationProjections: [projection],
		});
		projection.kind = "omit-assistant-text";
		expect(pinned?.conversationProjections).toEqual([{ entryId: "entry", kind: "omit-entry" }]);
		expect(Object.isFrozen(pinned?.conversationProjections?.[0])).toBe(true);
	});
});
