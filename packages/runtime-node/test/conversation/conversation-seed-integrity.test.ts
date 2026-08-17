import type { ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import { documentFromFile, parseConversationFile } from "../../src/conversation/conversation-file-codec.js";
import { CONVERSATION_STORAGE_ERROR_CODES, ConversationStorageError } from "../../src/conversation/index.js";

describe("conversation seed integrity", () => {
	it.each(["native", "import", "continuation"] as const)(
		"accepts valid %s seeds with product graph semantics",
		(seedKind) => {
			const entries: ConversationDocumentEntry[] = [
				custom("root", null),
				custom("summarized-sibling", "root"),
				{
					type: "branch_summary",
					id: "summary",
					parentId: "root",
					timestamp: timestamp(3),
					fromId: "summarized-sibling",
					summary: "summary",
				},
				{
					type: "compaction",
					id: "compaction",
					parentId: "summary",
					timestamp: timestamp(4),
					firstKeptEntryId: "tail",
					summary: "compacted",
					tokensBefore: 10,
				},
				custom("tail", "compaction"),
				{
					type: "label",
					id: "label",
					parentId: "tail",
					timestamp: timestamp(6),
					targetId: "summarized-sibling",
				},
			];
			const parsed = parseConversationFile(seedFile(seedKind, entries, "label"), sessionId(seedKind));

			expect(documentFromFile(sessionId(seedKind), parsed)).toMatchObject({
				activeLeafId: "label",
				revision: entries.length,
			});
		},
	);

	it.each(["native", "import", "continuation"] as const)("maps invalid %s seed graphs to CORRUPT", (seedKind) => {
		const invalidGraphs: readonly (readonly ConversationDocumentEntry[])[] = [
			[custom("orphan", "missing")],
			[custom("cycle-a", "cycle-b"), custom("cycle-b", "cycle-a")],
			[
				custom("root", null),
				{
					type: "branch_summary",
					id: "summary",
					parentId: "root",
					timestamp: timestamp(2),
					fromId: "missing",
					summary: "summary",
				},
			],
			[
				custom("root", null),
				{
					type: "label",
					id: "label",
					parentId: "root",
					timestamp: timestamp(2),
					targetId: "missing",
				},
			],
			[
				custom("root", null),
				custom("sibling", "root"),
				{
					type: "compaction",
					id: "compaction",
					parentId: "root",
					timestamp: timestamp(3),
					firstKeptEntryId: "sibling",
					summary: "summary",
					tokensBefore: 10,
				},
			],
		];

		for (const [index, entries] of invalidGraphs.entries()) {
			const parse = () =>
				parseConversationFile(seedFile(seedKind, entries, entries.at(-1)?.id ?? null), sessionId(seedKind));
			expect(parse, `invalid graph ${index}`).toThrow(ConversationStorageError);
			try {
				parse();
			} catch (error) {
				expect(error).toMatchObject({ code: CONVERSATION_STORAGE_ERROR_CODES.CORRUPT });
			}
		}
	});

	it.each(["native", "import", "continuation"] as const)("rejects a missing %s active leaf as CORRUPT", (seedKind) => {
		expect(() =>
			parseConversationFile(seedFile(seedKind, [custom("root", null)], "missing"), sessionId(seedKind)),
		).toThrow(expect.objectContaining({ code: CONVERSATION_STORAGE_ERROR_CODES.CORRUPT }));
	});
});

function seedFile(
	seedKind: SeedKind,
	entries: readonly ConversationDocumentEntry[],
	activeLeafId: string | null,
): string {
	const id = sessionId(seedKind);
	const header = {
		recordType: "conversation.header",
		schemaVersion: 2,
		sessionId: id,
		createdAt: 1,
		...(seedKind === "continuation"
			? { parentSessionPath: "C:/source.conversation.jsonl", parentEntryId: "source-entry" }
			: {}),
	};
	const seed =
		seedKind === "native"
			? {
					recordType: "conversation.seed",
					schemaVersion: 2,
					entries,
					activeLeafId,
				}
			: seedKind === "continuation"
				? {
						recordType: "conversation.continuation.seed",
						schemaVersion: 2,
						sourceSessionId: "source",
						sourceSessionPath: "C:/source.conversation.jsonl",
						sourceEntryId: "source-entry",
						reason: "fixture",
						entries,
						activeLeafId,
					}
				: {
						recordType: "conversation.import.seed",
						schemaVersion: 2,
						source: { format: "coding-agent-jsonl", path: "C:/legacy.jsonl", sessionId: "source", version: 3 },
						entries,
						activeLeafId,
					};
	return `${JSON.stringify(header)}\n${JSON.stringify(seed)}\n`;
}

function custom(id: string, parentId: string | null): ConversationDocumentEntry {
	return { type: "custom", id, parentId, timestamp: timestamp(1), customType: "fixture" };
}

function sessionId(seedKind: SeedKind): string {
	return `${seedKind}-seed`;
}

function timestamp(second: number): string {
	return `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
}

type SeedKind = "native" | "import" | "continuation";
