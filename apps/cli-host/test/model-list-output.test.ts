import type { Api, Model } from "@vetta/ai";
import type { CodingAgentBootstrap } from "@vetta/coding-agent/bootstrap";
import { describe, expect, it, vi } from "vitest";
import { listModels } from "../src/model-list-output.js";

function modelWithoutOutputLimit(): Model<Api> {
	return {
		id: "test-model",
		name: "Test model",
		api: "openai-completions",
		provider: "custom",
		baseUrl: "https://example.invalid/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
	};
}

describe("model list output", () => {
	it("shows auto instead of inventing an output token limit", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const registry = {
			getAvailable: () => [modelWithoutOutputLimit()],
		} as CodingAgentBootstrap["modelRegistry"];

		try {
			await listModels(registry);
			expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("auto");
		} finally {
			log.mockRestore();
		}
	});
});
