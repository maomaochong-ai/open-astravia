import { describe, expect, it } from "vitest";
import {
	buildMessageNavigationTurns,
	filterMessageNavigationTurns,
	findActiveNavigationTurnIndex,
} from "./messageNavigationModel";
import type { ChatMessage } from "./types";

const messages: ChatMessage[] = [
	{ id: "user-1", role: "user", text: "  First   question  " },
	{ id: "assistant-1", role: "assistant", text: "First answer" },
	{ id: "compact", role: "compaction", text: "summary" },
	{ id: "user-2", role: "user", text: "Second question" },
	{ id: "assistant-2", role: "assistant", text: "Useful result" },
];

describe("message navigation model", () => {
	it("groups user and assistant messages into stable turns and skips compaction rows", () => {
		const turns = buildMessageNavigationTurns(messages);

		expect(turns).toHaveLength(2);
		expect(turns[0].entries.map((entry) => [entry.id, entry.messageIndex, entry.preview])).toEqual([
			["user-1", 0, "First question"],
			["assistant-1", 1, "First answer"],
		]);
		expect(turns[1].entries.map((entry) => [entry.id, entry.messageIndex])).toEqual([
			["user-2", 3],
			["assistant-2", 4],
		]);
	});

	it("keeps the full normalized text searchable while showing a bounded preview", () => {
		const longText = `${"前".repeat(80)} target`;
		const turns = buildMessageNavigationTurns([{ id: "user", role: "user", text: longText }]);

		expect(Array.from(turns[0].entries[0].preview)).toHaveLength(72);
		expect(turns[0].entries[0].preview.endsWith("…")).toBe(true);
		expect(filterMessageNavigationTurns(turns, "TARGET")).toHaveLength(1);
	});

	it("maps the visible message index back to its containing turn", () => {
		const turns = buildMessageNavigationTurns(messages);

		expect(findActiveNavigationTurnIndex(turns, 0)).toBe(0);
		expect(findActiveNavigationTurnIndex(turns, 2)).toBe(0);
		expect(findActiveNavigationTurnIndex(turns, 4)).toBe(1);
	});
});
