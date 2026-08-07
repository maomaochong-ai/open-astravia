import type { AgentMessage } from "@vetta/agent-core";
import type { Message } from "@vetta/ai";
import type { RuntimeMessageEnvelope } from "@vetta/runtime-core";
import type { ConversationDocument, ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import {
	COMPACTION_SUMMARY_PREFIX,
	COMPACTION_SUMMARY_SUFFIX,
	convertToLlm,
	PROMPT_RESOURCE_REFERENCE_TYPE,
} from "../../src/model-context/index.js";
import { type CodingAgentSessionEntry, projectCodingAgentSessionDocumentEntry } from "../../src/sessions/index.js";
import { normalizeCodingAgentLegacySessionEntry } from "../../src/sessions/legacy/entry-normalizer.js";
import { CodingAgentConversationContextProjector } from "../../src/sessions/projection/conversation-context-projector.js";

describe("Coding Agent Legacy session import normalizer", () => {
	it("uses the same Conversation projection policy for native and historical entries", () => {
		const entries: CodingAgentSessionEntry[] = [
			{
				type: "message",
				id: "extended",
				parentId: null,
				timestamp: "2026-01-01T00:00:01.000Z",
				message: {
					role: "bashExecution",
					command: "pwd",
					output: "C:/workspace",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					timestamp: 1,
				},
			},
			{
				type: "custom_message",
				id: "resource",
				parentId: "extended",
				timestamp: "2026-01-01T00:00:02.000Z",
				customType: PROMPT_RESOURCE_REFERENCE_TYPE,
				content: "resource",
				display: false,
			},
			{
				type: "compaction",
				id: "compaction",
				parentId: "resource",
				timestamp: "2026-01-01T00:00:03.000Z",
				summary: "summary",
				firstKeptEntryId: "extended",
				tokensBefore: 42,
			},
		];

		for (const entry of entries) {
			expect(normalizeCodingAgentLegacySessionEntry({ ...entry })).toEqual(
				projectCodingAgentSessionDocumentEntry(entry),
			);
		}
	});

	it("preserves official extended AgentMessage identities and their exact model projection", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "request", timestamp: 1 },
			{
				role: "bashExecution",
				command: "pwd",
				output: "C:/workspace",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 2,
			},
			{
				role: "bashExecution",
				command: "secret",
				output: "hidden",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: true,
				timestamp: 3,
			},
			{
				role: "custom",
				customType: "extension-context",
				content: "extension context",
				display: true,
				details: { source: "fixture" },
				timestamp: 4,
			},
			{
				role: "custom",
				customType: PROMPT_RESOURCE_REFERENCE_TYPE,
				content: "model invisible",
				display: false,
				timestamp: 5,
			},
			{ role: "branchSummary", summary: "branch", fromId: "entry-1", timestamp: 6 },
			{ role: "compactionSummary", summary: "compact", tokensBefore: 100, timestamp: 7 },
		];
		const document = normalizedDocument(
			messages.map((message, index) => legacyMessage(`entry-${index + 1}`, index, message)),
		);
		const envelopes = new CodingAgentConversationContextProjector().project(document);

		expect(envelopes.map(readIdentityRole)).toEqual(messages.map(({ role }) => role));
		expect(readModelMessages(envelopes)).toEqual(convertToLlm(messages));
		expect(document.entries.slice(1)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "custom_message",
					modelVisible: false,
					details: { agentMessage: expect.objectContaining({ role: "bashExecution", excludeFromContext: true }) },
				}),
			]),
		);
	});

	it("restores Legacy custom-message visibility and compaction summary semantics", () => {
		const document = normalizedDocument([
			legacyMessage("user-1", 0, { role: "user", content: "request", timestamp: 1 }),
			legacyEntry("context-1", "user-1", "custom_message", {
				customType: "extension-context",
				content: "visible context",
				display: false,
			}),
			legacyEntry("marker-1", "context-1", "custom_message", {
				customType: PROMPT_RESOURCE_REFERENCE_TYPE,
				content: "resource marker",
				display: false,
			}),
			legacyEntry("compaction-1", "marker-1", "compaction", {
				summary: "summary",
				firstKeptEntryId: "user-1",
				tokensBefore: 100,
			}),
		]);

		expect(document.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "context-1", modelVisible: true }),
				expect.objectContaining({ id: "marker-1", modelVisible: false }),
				expect.objectContaining({
					id: "compaction-1",
					summaryMessage: expect.objectContaining({ role: "user" }),
				}),
			]),
		);

		const projected = new CodingAgentConversationContextProjector().project(document);
		expect(readModelMessages(projected).map(messageText)).toEqual([
			`${COMPACTION_SUMMARY_PREFIX}summary${COMPACTION_SUMMARY_SUFFIX}`,
			"request",
			"visible context",
		]);
	});

	it("keeps unknown private message roles outside the V2 import boundary", () => {
		const entry = legacyMessage("private-1", 0, {
			role: "extension-private",
			payload: "private",
			timestamp: 1,
		});

		expect(normalizeCodingAgentLegacySessionEntry(entry)).toBe(entry);
	});
});

function legacyMessage(id: string, index: number, message: AgentMessage | Readonly<Record<string, unknown>>) {
	return legacyEntry(id, index === 0 ? null : `entry-${index}`, "message", { message });
}

function legacyEntry(id: string, parentId: string | null, type: string, fields: Readonly<Record<string, unknown>>) {
	return {
		type,
		id,
		parentId,
		timestamp: `2026-01-01T00:00:${id === "compaction-1" ? "10" : "01"}.000Z`,
		...fields,
	};
}

function readIdentityRole(envelope: RuntimeMessageEnvelope): string {
	if (envelope.kind === "message") return envelope.message.role;
	if (envelope.kind === "context") return "custom";
	if (!envelope.identity || typeof envelope.identity !== "object" || !("role" in envelope.identity)) return "";
	return typeof envelope.identity.role === "string" ? envelope.identity.role : "";
}

function readModelMessages(envelopes: readonly RuntimeMessageEnvelope[]): Message[] {
	return envelopes.flatMap((envelope) => {
		if (envelope.kind === "message") return [envelope.message];
		if (envelope.kind === "opaque" && envelope.modelMessage) return [envelope.modelMessage];
		return [];
	});
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("");
}

function normalizedDocument(records: readonly Readonly<Record<string, unknown>>[]): ConversationDocument {
	const entries = records.map(
		normalizeCodingAgentLegacySessionEntry,
	) as unknown as readonly ConversationDocumentEntry[];
	const activeLeafId = entries[entries.length - 1]?.id ?? null;
	return {
		identity: { sessionId: "legacy-source", createdAt: 0, cwd: "C:/workspace" },
		journalVersion: 0,
		revision: entries.length,
		entries,
		activeLeafId,
	};
}
