import {
	buildMessageFeedNavigationOutline,
	findActiveMessageFeedNavigationTurnIndex,
} from "@shared/components/message-feed/navigationModel";
import { describe, expect, it } from "vitest";
import { buildMessageNavigationTurns, findTopVisibleMessageIndex } from "./messageNavigationModel";
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
		expect(turns[0].entries.map((entry) => [entry.id, entry.itemIndex, entry.preview])).toEqual([
			["user-1", 0, "First question"],
			["assistant-1", 1, "First answer"],
		]);
		expect(turns[1].entries.map((entry) => [entry.id, entry.itemIndex])).toEqual([
			["user-2", 3],
			["assistant-2", 4],
		]);
	});

	it("keeps the full normalized text searchable while showing a bounded preview", () => {
		const longText = `${"前".repeat(130)} target`;
		const turns = buildMessageNavigationTurns([{ id: "user", role: "user", text: longText }]);

		expect(Array.from(turns[0].entries[0].preview)).toHaveLength(120);
		expect(turns[0].entries[0].preview.endsWith("…")).toBe(true);
		expect(buildMessageFeedNavigationOutline(turns, "TARGET")).toHaveLength(1);
	});

	it("lists one outline row per turn and jumps to the matching message", () => {
		const turns = buildMessageNavigationTurns(messages);

		expect(buildMessageFeedNavigationOutline(turns, "")).toEqual([
			{
				id: "turn-user-1",
				matchPreview: null,
				preview: "First question",
				targetItemIndex: 0,
				turnNumber: 1,
			},
			{
				id: "turn-user-2",
				matchPreview: null,
				preview: "Second question",
				targetItemIndex: 3,
				turnNumber: 2,
			},
		]);
		expect(buildMessageFeedNavigationOutline(turns, "useful")).toEqual([
			{
				id: "turn-user-2",
				matchPreview: "Useful result",
				preview: "Second question",
				targetItemIndex: 4,
				turnNumber: 2,
			},
		]);
	});

	it("resolves the top visible message from measured offsets instead of the rendered range", () => {
		// overscan 会把视窗上方的条目也算进 rendered range，这里 index 0/1 就是那种「渲染了但看不见」的条目。
		const rendered = [
			{ index: 0, offset: 0, size: 100 },
			{ index: 1, offset: 100, size: 100 },
			{ index: 2, offset: 200, size: 100 },
			{ index: 3, offset: 300, size: 100 },
		];

		expect(findTopVisibleMessageIndex(rendered, 0)).toBe(0);
		expect(findTopVisibleMessageIndex(rendered, 200)).toBe(2);
		expect(findTopVisibleMessageIndex(rendered, 250)).toBe(2);
		expect(findTopVisibleMessageIndex(rendered, 300)).toBe(3);
		// 滚到底时最后一条可能整体位于 scrollTop 之上，仍应停在它身上而不是回退到 null。
		expect(findTopVisibleMessageIndex(rendered, 5_000)).toBe(3);
		expect(findTopVisibleMessageIndex([], 0)).toBeNull();
	});

	it("maps the visible message index back to its containing turn", () => {
		const turns = buildMessageNavigationTurns(messages);

		expect(findActiveMessageFeedNavigationTurnIndex(turns, 0)).toBe(0);
		expect(findActiveMessageFeedNavigationTurnIndex(turns, 2)).toBe(0);
		expect(findActiveMessageFeedNavigationTurnIndex(turns, 4)).toBe(1);
	});
});
