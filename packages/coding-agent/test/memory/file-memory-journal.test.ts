import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, AssistantMessage, Model } from "@vetta/ai";
import { afterEach, describe, expect, it } from "vitest";
import { FileMemoryJournal } from "../../src/memory/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("FileMemoryJournal", () => {
	it("writes one completed-turn line with collapsed text and unique file paths", async () => {
		const root = await temporaryRoot();
		const journal = new FileMemoryJournal({ now: () => new Date(2026, 7, 5, 9, 7) });
		journal.appendTurn(root, assistantMessage("completed\n response", "stop"));

		expect(await readFile(join(root, "JOURNAL.md"), "utf8")).toBe(
			"# Work log — 2026-08-05\n\n- 09:07 completed response — files: report.md\n",
		);
	});

	it("skips failed turns and truncates rollover sections without throwing", async () => {
		const root = await temporaryRoot();
		const journal = new FileMemoryJournal({ now: () => new Date(2026, 7, 5, 9, 7) });
		journal.appendTurn(root, assistantMessage("failed", "error"));
		journal.appendRollover(root, "x".repeat(2_001));

		const content = await readFile(join(root, "JOURNAL.md"), "utf8");
		expect(content).toContain("## Rollover @ 09:07");
		expect(content).toContain(`${"x".repeat(2_000)}…\n`);
	});

	it("treats an unwritable location as best-effort", () => {
		const journal = new FileMemoryJournal();
		expect(() => journal.appendRollover(join(tmpdir(), "missing", "nested"), "summary")).not.toThrow();
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

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-memory-journal-"));
	temporaryRoots.push(root);
	return root;
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
