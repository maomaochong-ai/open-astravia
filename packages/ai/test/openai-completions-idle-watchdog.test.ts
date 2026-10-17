import { describe, expect, it, vi } from "vitest";
import type { Model } from "../src/types.js";

const model: Model<"openai-completions"> = {
	id: "reasoner",
	name: "Reasoner",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 16_000,
};

/** 真实传输在收到 abort signal 后会销毁底层连接；fake 用同一语义：abort 即拒绝挂起的 next()。 */
function createHangingStream(signal: AbortSignal | undefined) {
	return {
		async *[Symbol.asyncIterator]() {
			yield { choices: [{ delta: { content: "部分回复" }, finish_reason: null }] };
			await new Promise<never>((_resolve, reject) => {
				if (signal) signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
		},
	};
}

function createCompletingStream() {
	return {
		async *[Symbol.asyncIterator]() {
			yield { choices: [{ delta: { content: "回复" }, finish_reason: null }] };
			yield { choices: [{ delta: {}, finish_reason: "stop" }] };
		},
	};
}

async function importWithMock(hang: boolean) {
	vi.doMock("openai", () => ({
		default: class FakeOpenAI {
			chat = {
				completions: {
					create: async (_params: unknown, opts?: { signal?: AbortSignal }) =>
						hang ? createHangingStream(opts?.signal) : createCompletingStream(),
				},
			};
		},
	}));
	vi.resetModules();
	return import("../src/providers/openai-completions.js");
}

describe("openai-completions stream idle watchdog", () => {
	it("fails with AI_TIMEOUT when the stream hangs after opening", async () => {
		const { streamOpenAICompletions } = await importWithMock(true);
		const result = await streamOpenAICompletions(
			model,
			{ messages: [{ role: "user", content: "你好", timestamp: Date.now() }] },
			{ apiKey: "test", streamIdleTimeoutMs: 60 },
		).result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("no events");
	});

	it("still completes when chunks keep arriving within the window", async () => {
		const { streamOpenAICompletions } = await importWithMock(false);
		const result = await streamOpenAICompletions(
			model,
			{ messages: [{ role: "user", content: "你好", timestamp: Date.now() }] },
			{ apiKey: "test", streamIdleTimeoutMs: 5_000 },
		).result();

		expect(result.stopReason).toBe("stop");
	});

	it("disables the watchdog when streamIdleTimeoutMs is 0", async () => {
		const { streamOpenAICompletions } = await importWithMock(false);
		const result = await streamOpenAICompletions(
			model,
			{ messages: [{ role: "user", content: "你好", timestamp: Date.now() }] },
			{ apiKey: "test", streamIdleTimeoutMs: 0 },
		).result();

		expect(result.stopReason).toBe("stop");
	});
});
