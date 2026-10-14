import { describe, expect, it } from "vitest";
import type { FetchedProviderModel } from "../../preload/api-types/models.js";
import { enrichFetchedModels } from "./enrich-fetched-models.js";
import { type ModelsDevCatalog, resolveCatalogLookup } from "./presets/models-dev.js";
import { MODELS_DEV_SNAPSHOT } from "./presets/models-dev-snapshot.generated.js";

const CATALOG: ModelsDevCatalog = {
	version: 8,
	fetchedAt: "2026-01-01T00:00:00.000Z",
	providers: {},
	lookup: {
		"cline-pass": {
			"cline-pass/deepseek-v4.1-flash": {
				name: "DeepSeek V4.1 Flash",
				reasoning: true,
				reasoningLevels: ["none", "low", "high", "max"],
				contextWindow: 1048576,
				maxTokens: 384000,
				vision: true,
			},
		},
	},
};

function enrich(model: FetchedProviderModel): FetchedProviderModel {
	return enrichFetchedModels(CATALOG, [model])[0];
}

describe("enrichFetchedModels", () => {
	it("补齐网关没报的思考档位、上下文、最大输出与图片输入", () => {
		expect(enrich({ id: "clinepass/cline-pass/deepseek-v4.1-flash" })).toEqual({
			id: "clinepass/cline-pass/deepseek-v4.1-flash",
			name: "DeepSeek V4.1 Flash",
			reasoning: true,
			reasoningLevels: ["none", "low", "high", "max"],
			contextWindow: 1048576,
			maxTokens: 384000,
			vision: true,
		});
	});

	it("网关报了的字段一律以网关为准", () => {
		expect(
			enrich({
				id: "clinepass/cline-pass/deepseek-v4.1-flash",
				name: "网关自己的名字",
				reasoningLevels: ["low", "high"],
				contextWindow: 65536,
				maxTokens: 8192,
				vision: false,
				reasoning: false,
			}),
		).toEqual({
			id: "clinepass/cline-pass/deepseek-v4.1-flash",
			name: "网关自己的名字",
			reasoning: false,
			reasoningLevels: ["low", "high"],
			contextWindow: 65536,
			maxTokens: 8192,
			vision: false,
		});
	});

	it("目录里查不到的模型原样返回，不猜任何参数", () => {
		const model: FetchedProviderModel = { id: "qwen3.8-35b" };
		expect(enrich(model)).toEqual(model);
	});

	it("没有目录时不做任何补全", () => {
		const model: FetchedProviderModel = { id: "clinepass/cline-pass/deepseek-v4.1-flash" };
		expect(enrichFetchedModels(null, [model])).toEqual([model]);
	});

	it("随包快照能补齐只有 id 的聚合网关条目", () => {
		// 挑一个带厂商命名空间的真实键，模拟“网关只回了 id”的情况。
		const namespaced = Object.keys(MODELS_DEV_SNAPSHOT.lookup.openrouter).find((key) => key.includes("/"));
		expect(namespaced).toBeDefined();
		const hit = resolveCatalogLookup(MODELS_DEV_SNAPSHOT, namespaced as string);
		const [enriched] = enrichFetchedModels(MODELS_DEV_SNAPSHOT, [{ id: namespaced as string }]);
		expect(enriched.contextWindow).toBe(hit?.entry.contextWindow);
		expect(enriched.reasoningLevels).toEqual(hit?.entry.reasoningLevels);
	});
});
