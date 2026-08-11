import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FileMemoryStore,
	MemoryFlushService,
	parseMemoryFactCandidates,
	serializeMessagesForMemoryFlush,
} from "../../src/memory/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Memory flush service", () => {
	it("serializes only user and assistant text and parses the existing line protocol", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "request", timestamp: 1 },
			assistantMessage("response"),
			{ role: "custom", customType: "note", content: "hidden", display: false, timestamp: 2 },
		];
		expect(serializeMessagesForMemoryFlush(messages)).toBe("USER: request\n\nASSISTANT: response");
		expect(parseMemoryFactCandidates("NONE\n- Uses Bun\nignored\n-  TypeScript ")).toEqual([
			"Uses Bun",
			"TypeScript",
		]);
	});

	it("deduplicates candidates and stops at the first failed write", async () => {
		const root = await temporaryRoot();
		const store = new FileMemoryStore({ path: join(root, "MEMORY.md"), charLimit: 30 });
		store.apply("add", { content: "Uses Bun" });
		const extractor = {
			extract: vi.fn(async () => ["Bun", "Uses TypeScript", "never written"]),
		};
		const service = new MemoryFlushService(store, extractor);

		await expect(
			service.flush({
				messages: [{ role: "user", content: "remember this", timestamp: 1 }],
				model: MODEL,
				apiKey: "key",
				signal: new AbortController().signal,
			}),
		).resolves.toEqual(["Uses TypeScript"]);
		expect(store.readEntries()).toEqual(["Uses Bun", "Uses TypeScript"]);
		expect(extractor.extract).toHaveBeenCalledWith(
			expect.objectContaining({ currentEntries: ["Uses Bun"], model: MODEL, apiKey: "key" }),
		);
	});

	it("keeps extractor failures best-effort", async () => {
		const root = await temporaryRoot();
		const store = new FileMemoryStore({ path: join(root, "MEMORY.md") });
		const service = new MemoryFlushService(store, {
			extract: async () => {
				throw new Error("provider unavailable");
			},
		});
		await expect(
			service.flush({
				messages: [],
				model: MODEL,
				apiKey: "key",
				signal: new AbortController().signal,
			}),
		).resolves.toEqual([]);
	});
});

function assistantMessage(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
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
		stopReason: "stop" as const,
		timestamp: 1,
	};
}

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-memory-flush-"));
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
