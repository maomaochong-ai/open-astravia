import type { Api, AssistantMessage, Model, UserMessage } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import { CompactionPrefireCache } from "../../../src/adapters/runtime-core/context-runtime/compaction-prefire-cache.js";
import type { CompactionResult, CompactionSettings } from "../../../src/compaction/index.js";
import type { CodingAgentSessionEntry as SessionEntry } from "../../../src/sessions/index.js";

describe("CompactionPrefireCache", () => {
	it("caches a completed prefire and consumes it once", async () => {
		const result: CompactionResult = {
			summary: "prefired",
			firstKeptEntryId: "entry-3",
			tokensBefore: 90,
		};
		const generateCompaction = vi.fn(async () => result);
		const cache = new CompactionPrefireCache({
			resolveApiKey: () => "key",
			generateCompaction,
			canAttempt: () => true,
		});

		cache.start(ENTRIES, SETTINGS, MODEL);
		await vi.waitFor(() => expect(generateCompaction).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(cache.take(ENTRIES)).toEqual(result));
		expect(cache.take(ENTRIES)).toBeUndefined();
	});

	it("aborts an in-flight prefire when disposed", async () => {
		let observedSignal: AbortSignal | undefined;
		const generateCompaction = vi.fn(
			async (_preparation, _model, _apiKey, _instructions, signal): Promise<CompactionResult> => {
				observedSignal = signal;
				return new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
			},
		);
		const cache = new CompactionPrefireCache({
			resolveApiKey: () => "key",
			generateCompaction,
			canAttempt: () => true,
		});

		cache.start(ENTRIES, SETTINGS, MODEL);
		await vi.waitFor(() => expect(observedSignal).toBeDefined());
		cache.dispose();

		expect(observedSignal?.aborted).toBe(true);
		expect(cache.take(ENTRIES)).toBeUndefined();
	});
});

const SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 20,
	minFreePercent: 20,
	keepRecentTokens: 1,
};

const ENTRIES: readonly SessionEntry[] = [
	{
		type: "message",
		id: "entry-1",
		parentId: null,
		timestamp: new Date(1).toISOString(),
		message: userMessage("old request".repeat(40), 1),
	},
	{
		type: "message",
		id: "entry-2",
		parentId: "entry-1",
		timestamp: new Date(2).toISOString(),
		message: assistantMessage("old response", 90, 2),
	},
	{
		type: "message",
		id: "entry-3",
		parentId: "entry-2",
		timestamp: new Date(3).toISOString(),
		message: userMessage("kept request", 3),
	},
];

function userMessage(text: string, timestamp: number): UserMessage {
	return { role: "user", content: text, timestamp };
}

function assistantMessage(text: string, totalTokens: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "test",
		model: "model",
		usage: {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
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
