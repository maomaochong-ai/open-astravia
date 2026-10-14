import type { AssistantMessage } from "@vetta/ai";
import type { HistoryEntry } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { fullHistoryToChat } from "./chat-service";

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		timestamp: 0,
	} as unknown as AssistantMessage;
}

const user = (turnId: string, text: string): HistoryEntry => ({
	type: "message",
	entryId: `user-${turnId}`,
	messageId: `user-${turnId}`,
	turnId,
	message: { role: "user", content: text, timestamp: 1 },
});

const reply = (turnId: string, text: string): HistoryEntry => ({
	type: "message",
	entryId: `reply-${turnId}-${text}`,
	turnId,
	message: assistant(text),
});

const compaction = (turnId?: string): HistoryEntry => ({
	type: "compaction",
	entryId: `compaction-${turnId ?? "manual"}`,
	summary: "earlier work",
	tokensBefore: 120_000,
	...(turnId ? { turnId } : {}),
	timestamp: new Date(5).toISOString(),
});

function shape(entries: HistoryEntry[]) {
	return fullHistoryToChat(entries).map((item) =>
		item.kind === "agent"
			? { kind: item.kind, id: item.id, blocks: item.blocks.map((block) => block.type) }
			: { kind: item.kind, id: item.id },
	);
}

describe("fullHistoryToChat context compaction", () => {
	it("keeps mid-Turn compaction inside that Turn's reply instead of splitting it", () => {
		expect(shape([user("t1", "go"), reply("t1", "first"), compaction("t1"), reply("t1", "second")])).toEqual([
			{ kind: "user", id: "user-t1" },
			{ kind: "agent", id: "assistant:t1:1", blocks: ["text", "compaction", "text"] },
		]);
	});

	it("opens the reply with Turn-start compaction recorded before the user message", () => {
		expect(
			shape([
				user("t1", "old"),
				reply("t1", "old reply"),
				compaction("t2"),
				user("t2", "go"),
				reply("t2", "answer"),
			]),
		).toEqual([
			{ kind: "user", id: "user-t1" },
			{ kind: "agent", id: "assistant:t1:1", blocks: ["text"] },
			{ kind: "user", id: "user-t2" },
			{ kind: "agent", id: "assistant:t2:1", blocks: ["compaction", "text"] },
		]);
	});

	it("shows the running Turn's reply with its compaction step before any output", () => {
		expect(shape([compaction("t1"), user("t1", "go")])).toEqual([
			{ kind: "user", id: "user-t1" },
			{ kind: "agent", id: "assistant:t1:1", blocks: ["compaction"] },
		]);
	});

	it("keeps manual compaction a boundary between Turns", () => {
		expect(shape([user("t1", "go"), reply("t1", "done"), compaction()])).toEqual([
			{ kind: "user", id: "user-t1" },
			{ kind: "agent", id: "assistant:t1:1", blocks: ["text"] },
			{ kind: "event", id: "compaction-manual" },
		]);
	});

	it("carries the summary and the context size before compaction", () => {
		const [, agent] = fullHistoryToChat([user("t1", "go"), reply("t1", "first"), compaction("t1")]);
		expect(agent?.kind === "agent" && agent.blocks[1]).toEqual({
			type: "compaction",
			id: "compaction-t1",
			status: "success",
			summary: "earlier work",
			tokensBefore: 120_000,
		});
	});
});
