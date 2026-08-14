import { describe, expect, it } from "vitest";
import { parseCodingAgentLegacySessionDocument } from "../../../coding-agent/src/sessions/legacy/document.js";
import {
	branchFromFileEntries,
	entriesToHistory,
} from "../../../coding-agent/src/sessions/projection/session-history.js";
import { projectConversationDocumentHistory } from "../../../runtime-core/src/conversation/index.js";
import { parseLegacySessionDocument } from "../../src/conversation/index.js";

describe("LegacySessionDocumentReader", () => {
	it("preserves the v3 active branch and host history projection", () => {
		const content = toJsonLines([
			{
				type: "session",
				version: 3,
				id: "legacy-session",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: "C:/workspace",
			},
			messageEntry("root", null, "assistant", "root"),
			customMessageEntry("skill-a", "root", "skill_expansion", { promptRef: { kind: "skill", name: "a" } }),
			messageEntry("user-a", "skill-a", "user", "first version"),
			messageEntry("assistant-a", "user-a", "assistant", "old response"),
			customMessageEntry("skill-b", "root", "skill_expansion", { promptRef: { kind: "skill", name: "b" } }),
			messageEntry("user-b", "skill-b", "user", "second version"),
			{
				type: "custom",
				id: "timing",
				parentId: "user-b",
				timestamp: "2026-01-01T00:00:07.000Z",
				customType: "vetta.assistant_turn_timing",
				data: { startedAt: 1, endedAt: 3, durationMs: 2 },
			},
			{
				type: "tool_timing",
				id: "tool",
				parentId: "timing",
				timestamp: "2026-01-01T00:00:08.000Z",
				toolCallId: "call-1",
				toolName: "read",
				startedAt: 10,
				durationMs: 5,
				phases: [{ label: "open", atMs: 1 }],
			},
			messageEntry("assistant-b", "tool", "assistant", "new response"),
		]);
		const legacyDocument = parseCodingAgentLegacySessionDocument(`${content}{bad json\n`);
		const allEntries = [...legacyDocument.entries];
		const expected = entriesToHistory(branchFromFileEntries([legacyDocument.header, ...allEntries]), {
			allEntries,
		});

		const document = parseLegacySessionDocument(`${content}{bad json\n`);

		expect(document.identity).toMatchObject({
			sessionId: "legacy-session",
			cwd: "C:/workspace",
		});
		expect(document.activeLeafId).toBe("assistant-b");
		expect(projectConversationDocumentHistory(document)).toEqual(expected);
	});

	it("normalizes v1 entries into a deterministic linear tree", () => {
		const document = parseLegacySessionDocument(
			toJsonLines([
				{
					type: "session",
					id: "legacy-v1",
					timestamp: "2026-01-01T00:00:00.000Z",
					cwd: "",
				},
				{
					type: "message",
					timestamp: "2026-01-01T00:00:01.000Z",
					message: { role: "user", content: "one", timestamp: 1 },
				},
				{
					type: "message",
					timestamp: "2026-01-01T00:00:02.000Z",
					message: { role: "user", content: "two", timestamp: 2 },
				},
			]),
		);

		expect(document.entries.map(({ id, parentId }) => ({ id, parentId }))).toEqual([
			{ id: "legacy-1", parentId: null },
			{ id: "legacy-2", parentId: "legacy-1" },
		]);
		expect(document.activeLeafId).toBe("legacy-2");
	});

	it("rejects content without the required Legacy header", () => {
		expect(() => parseLegacySessionDocument(toJsonLines([messageEntry("one", null, "user", "hello")]))).toThrow(
			"valid header",
		);
	});
});

function toJsonLines(records: readonly unknown[]): string {
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function messageEntry(id: string, parentId: string | null, role: "user" | "assistant", text: string) {
	return {
		type: "message",
		id,
		parentId,
		timestamp: `2026-01-01T00:00:${id === "root" ? "01" : "05"}.000Z`,
		message:
			role === "user"
				? { role, content: text, timestamp: 1 }
				: {
						role,
						content: [{ type: "text", text }],
						api: "openai-responses",
						provider: "openai",
						model: "test",
						usage: {
							input: 1,
							output: 1,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 2,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "stop",
						timestamp: 2,
					},
	};
}

function customMessageEntry(id: string, parentId: string, customType: string, details: unknown) {
	return {
		type: "custom_message",
		id,
		parentId,
		timestamp: "2026-01-01T00:00:04.000Z",
		customType,
		content: "hidden",
		details,
		display: false,
	};
}
