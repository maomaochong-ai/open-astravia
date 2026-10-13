import { describe, expect, it } from "vitest";
import {
	deselectModels,
	filterFetchedModels,
	normalizeFetchedModelQuery,
	selectModels,
	toggleModelSelection,
} from "./fetched-models";

const MODELS = [
	{ id: "qwen3:8b", name: "Qwen3 8B", reasoning: true },
	{ id: "llama3:latest" },
	{ id: "gpt-4o-mini", ownedBy: "openai" },
] as const;

describe("filterFetchedModels", () => {
	it("keeps the whole list when the query is blank", () => {
		expect(filterFetchedModels(MODELS, "  ")).toEqual([...MODELS]);
	});

	it("matches on id and display name, ignoring case and full-width characters", () => {
		expect(filterFetchedModels(MODELS, "QWEN").map((model) => model.id)).toEqual(["qwen3:8b"]);
		expect(filterFetchedModels(MODELS, "８ｂ").map((model) => model.id)).toEqual(["qwen3:8b"]);
		expect(filterFetchedModels(MODELS, "llama3").map((model) => model.id)).toEqual(["llama3:latest"]);
	});

	it("returns nothing when no model matches", () => {
		expect(filterFetchedModels(MODELS, "gpt-5")).toEqual([]);
	});
});

describe("normalizeFetchedModelQuery", () => {
	it("trims, normalizes width and lowercases", () => {
		expect(normalizeFetchedModelQuery("  Ｑｗｅｎ３  ")).toBe("qwen3");
	});
});

describe("selection helpers", () => {
	it("toggles one id on and off", () => {
		expect(toggleModelSelection([], "a")).toEqual(["a"]);
		expect(toggleModelSelection(["a", "b"], "a")).toEqual(["b"]);
	});

	it("selects only the ids it is given", () => {
		expect(selectModels(["a"], ["b", "a"])).toEqual(["a", "b"]);
	});

	it("deselects only the ids it is given, keeping filtered-out selections", () => {
		expect(deselectModels(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
	});
});
