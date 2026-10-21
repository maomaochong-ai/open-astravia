import type { ConversationDocument } from "@astravia/runtime-core/conversation";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
} from "@astravia/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import {
	applyConversationRecords,
	initialConversationDocument,
	type ParsedConversationFile,
	parseConversationFile,
} from "../../src/conversation/conversation-file-codec.js";

/** 解析结果里的原始记录：v1 消息记录没有 documentEntry，只有当前版本才带。 */
type ConversationBodyRecord = ParsedConversationFile["records"][number];

const SESSION_ID = "11111111-2222-4333-8444-555555555555";

function messageEvent(sequence: number, text: string, parentId: string | null): string {
	return JSON.stringify({
		recordType: "conversation.event",
		schemaVersion: 2,
		sequence,
		event: {
			type: "message.appended",
			sessionId: SESSION_ID,
			turnId: "turn-1",
			messageId: `message-${sequence}`,
			message: { role: "user", content: [{ type: "text", text }], timestamp: 1000 + sequence },
			timestamp: 1000 + sequence,
		},
		documentEntry: { id: `entry-${sequence}`, parentId, timestamp: new Date(1000 + sequence).toISOString() },
	});
}

function header(): string {
	return JSON.stringify({
		recordType: "conversation.header",
		schemaVersion: 2,
		sessionId: SESSION_ID,
		createdAt: 1000,
		agentId: "coding-agent",
		cwd: "/workspace",
	});
}

/** 折叠出一条 6 条消息的会话文件，中间夹一条文档命令。 */
function conversationText(): string {
	return `${[
		header(),
		messageEvent(1, "first", null),
		messageEvent(2, "second", "entry-1"),
		JSON.stringify({
			recordType: "conversation.document.operation",
			schemaVersion: 2,
			revision: 3,
			command: { type: "session.name.set", name: "逐条折叠" },
		}),
		messageEvent(3, "third", "entry-2"),
		messageEvent(4, "fourth", "entry-3"),
		messageEvent(5, "fifth", "entry-4"),
	].join("\n")}\n`;
}

function stepwise(records: readonly ConversationBodyRecord[], document: ConversationDocument): ConversationDocument {
	let projected = document;
	for (const record of records) {
		if (record.recordType === "conversation.event") {
			const documentEntry = "documentEntry" in record ? (record.documentEntry ?? undefined) : undefined;
			projected = applyStoredEventToConversationDocument(projected, record.event, record.sequence, documentEntry);
			continue;
		}
		projected = applyConversationDocumentCommand(projected, record.command, record.revision).document;
	}
	return projected;
}

/** 投影失败会被装成存储错误，具体原因在 cause 上。 */
function projectionCause(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		const cause = (error as { cause?: { message?: string } }).cause;
		return cause?.message ?? (error as Error).message;
	}
	throw new Error("expected the projection to fail");
}

describe("applyConversationRecords entry index", () => {
	it("produces the same document as folding one record at a time", () => {
		const file = parseConversationFile(conversationText(), SESSION_ID);
		const initial = initialConversationDocument(SESSION_ID, file);

		const batched = applyConversationRecords(SESSION_ID, initial, file.records);
		const oneByOne = stepwise(file.records, initial);

		expect(batched).toEqual(oneByOne);
		expect(batched.entries).toHaveLength(5);
		expect(batched.name).toBe("逐条折叠");
	});

	it("still rejects a duplicate entry id", () => {
		const file = parseConversationFile(conversationText(), SESSION_ID);
		const initial = initialConversationDocument(SESSION_ID, file);
		const duplicate: ConversationBodyRecord = {
			recordType: "conversation.event",
			schemaVersion: 2,
			sequence: 6,
			event: {
				type: "message.appended",
				sessionId: SESSION_ID,
				turnId: "turn-1",
				messageId: "message-6",
				message: { role: "user", content: [{ type: "text", text: "dup" }], timestamp: 1010 },
				timestamp: 1010,
			},
			documentEntry: { id: "entry-1", parentId: "entry-5", timestamp: new Date(1010).toISOString() },
		};

		expect(
			projectionCause(() => applyConversationRecords(SESSION_ID, initial, [...file.records, duplicate])),
		).toMatch(/entry already exists/);
	});

	it("still rejects an entry whose parent is missing", () => {
		const file = parseConversationFile(conversationText(), SESSION_ID);
		const initial = initialConversationDocument(SESSION_ID, file);
		const orphan: ConversationBodyRecord = {
			recordType: "conversation.event",
			schemaVersion: 2,
			sequence: 6,
			event: {
				type: "message.appended",
				sessionId: SESSION_ID,
				turnId: "turn-1",
				messageId: "message-6",
				message: { role: "user", content: [{ type: "text", text: "orphan" }], timestamp: 1010 },
				timestamp: 1010,
			},
			documentEntry: { id: "entry-6", parentId: "missing-entry", timestamp: new Date(1010).toISOString() },
		};

		expect(projectionCause(() => applyConversationRecords(SESSION_ID, initial, [...file.records, orphan]))).toMatch(
			/parent does not exist/,
		);
	});
});
