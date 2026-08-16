import type { Api, AssistantMessage, Model } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { MemoryJournalWriter } from "../../src/memory/index.js";
import { createMemoryTextStorage, readMemoryTextStorage } from "../fixtures/memory-storage.js";

describe("MemoryJournalWriter", () => {
	it("writes one completed-turn line with collapsed text and unique file paths", async () => {
		const storage = createMemoryTextStorage();
		const journal = new MemoryJournalWriter(storage, { now: () => new Date(2026, 7, 5, 9, 7) });
		journal.appendTurn("ignored", assistantMessage("completed\n response", "stop"));

		expect(readMemoryTextStorage(storage)).toBe(
			"# Work log — 2026-08-05\n\n- 09:07 completed response — files: report.md\n",
		);
	});

	it("skips failed turns and truncates rollover sections without throwing", async () => {
		const storage = createMemoryTextStorage();
		const journal = new MemoryJournalWriter(storage, { now: () => new Date(2026, 7, 5, 9, 7) });
		journal.appendTurn("ignored", assistantMessage("failed", "error"));
		journal.appendRollover("ignored", "x".repeat(2_001));

		const content = readMemoryTextStorage(storage);
		expect(content).toContain("## Rollover @ 09:07");
		expect(content).toContain(`${"x".repeat(2_000)}…\n`);
	});

	it("treats an unwritable location as best-effort", () => {
		const storage = {
			read: () => undefined,
			replace: () => {
				throw new Error("unwritable");
			},
			append: () => {
				throw new Error("unwritable");
			},
		};
		const journal = new MemoryJournalWriter(storage);
		expect(() => journal.appendRollover("ignored", "summary")).not.toThrow();
	});
});

function assistantMessage(text: string, stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text },
			{ type: "toolCall", id: "tool-1", name: "write", arguments: { path: "report.md" } },
			{ type: "toolCall", id: "tool-2", name: "edit", arguments: { file_path: "report.md" } },
		],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100,
	maxTokens: 20,
};
