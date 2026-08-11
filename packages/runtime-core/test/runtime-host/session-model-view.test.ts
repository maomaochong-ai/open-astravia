import type { Api, Model } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeSessionModelView } from "../../src/index.js";
import { resolvePeripheralCandidates } from "../../src/runtime-host/peripheral-tasks.js";

function createModel(provider: string, id: string): Model<Api> {
	return { api: "openai-responses", provider, id, input: ["text"] } as Model<Api>;
}

describe("RuntimeSessionModelView", () => {
	it("keeps current-model priority, deduplication, available order and the three-candidate limit", async () => {
		const current = createModel("stage43-priority", "current");
		const second = createModel("stage43-priority", "second");
		const third = createModel("stage43-priority", "third");
		const fourth = createModel("stage43-priority", "fourth");
		const view = createView(current, [current, second, third, fourth], async (model) => `key:${model.id}`);

		const candidates = await resolvePeripheralCandidates(view);

		expect(candidates.map((candidate) => candidate.key)).toEqual([
			"stage43-priority/current",
			"stage43-priority/second",
			"stage43-priority/third",
		]);
		expect(view.refreshAvailableModels).toHaveBeenCalledOnce();
		expect(view.resolveApiKey).toHaveBeenCalledTimes(3);
	});

	it("skips candidates without credentials while preserving later available candidates", async () => {
		const current = createModel("stage43-credentials", "current");
		const available = createModel("stage43-credentials", "available");
		const view = createView(current, [available], async (model) =>
			model.id === "available" ? "available-key" : undefined,
		);

		const candidates = await resolvePeripheralCandidates(view);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({ key: "stage43-credentials/available", apiKey: "available-key" });
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
