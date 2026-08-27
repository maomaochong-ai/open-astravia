import type { Api, Model } from "@vetta/ai";
import type { RuntimeSessionModelView } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import {
	cleanSuggestionList,
	resolveSessionAssistanceCandidates,
	sanitizeAutoTitle,
	sanitizeSuggestions,
} from "../src/features/session-assistance/session-assistance-runtime.js";

function createModel(provider: string, id: string): Model<Api> {
	return { api: "openai-responses", provider, id, input: ["text"] } as Model<Api>;
}

describe("CodingAgentSessionAssistanceRuntime", () => {
	it("keeps current-model priority, deduplication, available order and the three-candidate limit", async () => {
		const current = createModel("session-assistance-priority", "current");
		const second = createModel("session-assistance-priority", "second");
		const third = createModel("session-assistance-priority", "third");
		const fourth = createModel("session-assistance-priority", "fourth");
		const view = createView(current, [current, second, third, fourth], async (model) => `key:${model.id}`);

		const candidates = await resolveSessionAssistanceCandidates(view);

		expect(candidates.map((candidate) => candidate.key)).toEqual([
			"session-assistance-priority/current",
			"session-assistance-priority/second",
			"session-assistance-priority/third",
		]);
		expect(view.refreshAvailableModels).toHaveBeenCalledOnce();
		expect(view.resolveApiKey).toHaveBeenCalledTimes(3);
	});

	it("skips candidates without credentials while preserving later available candidates", async () => {
		const current = createModel("session-assistance-credentials", "current");
		const available = createModel("session-assistance-credentials", "available");
		const view = createView(current, [available], async (model) =>
			model.id === "available" ? "available-key" : undefined,
		);

		const candidates = await resolveSessionAssistanceCandidates(view);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			key: "session-assistance-credentials/available",
			apiKey: "available-key",
		});
	});

	it("sanitizes product title and suggestion fallbacks without leaking prose", () => {
		expect(sanitizeAutoTitle('  "修复 Runtime 架构。"  ')).toBe("修复 Runtime 架构");
		expect(sanitizeSuggestions('analysis [step 1]\n["继续重构", "补充测试"]')).toEqual(["继续重构", "补充测试"]);
		expect(cleanSuggestionList(["继续重构", "继续重构", 42, "补充测试"])).toEqual(["继续重构", "补充测试"]);
	});
});

function createView(
	current: Model<Api> | undefined,
	available: readonly Model<Api>[],
	resolve: (model: Model<Api>) => Promise<string | undefined>,
): RuntimeSessionModelView & {
	refreshAvailableModels: ReturnType<typeof vi.fn>;
	resolveApiKey: ReturnType<typeof vi.fn>;
} {
	return {
		readCurrentModel: () => current,
		refreshAvailableModels: vi.fn(),
		readAvailableModels: () => available,
		resolveApiKey: vi.fn(resolve),
	};
}
