import { describe, expect, it } from "vitest";
import { type ModelsDevCatalog, resolveCatalogLookup } from "./models-dev.js";
import { MODELS_DEV_SNAPSHOT } from "./models-dev-snapshot.generated.js";

/** 目录形状照抄 models.dev 真实数据：聚合家的 model key 里自己也带一层厂商前缀。 */
const CATALOG: ModelsDevCatalog = {
	version: 8,
	fetchedAt: "2026-01-01T00:00:00.000Z",
	providers: {},
	lookup: {
		anthropic: {
			"claude-opus-5": { reasoning: true, reasoningLevels: ["low", "medium", "high"], contextWindow: 200000 },
		},
		deepseek: {
			"deepseek-v4-pro": { reasoning: true, reasoningLevels: ["low", "high", "max"], contextWindow: 1000000 },
		},
		openrouter: {
			"deepseek/deepseek-v4.1-flash": {
				name: "DeepSeek V4.1 Flash",
				reasoning: true,
				reasoningLevels: ["low", "high", "max"],
				contextWindow: 1048576,
				maxTokens: 393216,
				vision: true,
			},
			"upstage/solar-mini4": { reasoningLevels: ["none", "high"], contextWindow: 32768 },
		},
		"cline-pass": {
			"cline-pass/deepseek-v4.1-flash": {
				name: "DeepSeek V4.1 Flash",
				reasoning: true,
				reasoningLevels: ["none", "low", "high", "max"],
				contextWindow: 1048576,
			},
		},
	},
};

describe("resolveCatalogLookup", () => {
	it("匹配 `<家>/<model key>` 形状的 id", () => {
		expect(resolveCatalogLookup(CATALOG, "openrouter/deepseek/deepseek-v4.1-flash")).toMatchObject({
			provider: "openrouter",
			modelId: "deepseek/deepseek-v4.1-flash",
		});
	});

	it("逐层剥掉网关自己叠的命名空间后再匹配", () => {
		// clinepass / xxx 都只是网关的命名空间；真正的 model key 是 `cline-pass/deepseek-v4.1-flash`。
		const hit = resolveCatalogLookup(CATALOG, "clinepass/cline-pass/deepseek-v4.1-flash");
		expect(hit).toMatchObject({ provider: "cline-pass", modelId: "cline-pass/deepseek-v4.1-flash" });
		expect(hit?.entry.reasoningLevels).toEqual(["none", "low", "high", "max"]);

		expect(resolveCatalogLookup(CATALOG, "gateway/clinepass/cline-pass/deepseek-v4.1-flash")).toMatchObject({
			provider: "cline-pass",
			modelId: "cline-pass/deepseek-v4.1-flash",
		});
	});

	it("同一 id 命中多家时按固定优先级取，不随遍历顺序漂移", () => {
		const shared: ModelsDevCatalog = {
			...CATALOG,
			lookup: {
				...CATALOG.lookup,
				openrouter: { ...CATALOG.lookup.openrouter, "mimo-v2.6-flash": { reasoningLevels: ["low"] } },
				"cline-pass": { ...CATALOG.lookup["cline-pass"], "mimo-v2.6-flash": { reasoningLevels: ["high"] } },
			},
		};
		expect(resolveCatalogLookup(shared, "mimo-v2.6-flash")).toMatchObject({ provider: "openrouter" });
	});

	it("网关只给裸模型名时，用 openrouter 的后缀匹配兜底", () => {
		expect(resolveCatalogLookup(CATALOG, "deepseek-v4.1-flash")).toMatchObject({
			provider: "openrouter",
			modelId: "deepseek/deepseek-v4.1-flash",
		});
	});

	it("查不到就返回 undefined——不拿随便一家的档位兜底", () => {
		expect(resolveCatalogLookup(CATALOG, "qwen3.8-35b")).toBeUndefined();
		expect(resolveCatalogLookup(CATALOG, "deepseek-v4.1-flash-vision-exp")).toBeUndefined();
		expect(resolveCatalogLookup(null, "deepseek-v4-pro")).toBeUndefined();
	});

	it("随包快照带着查找投影，且聚合家的键可按命名空间前缀解析", () => {
		const openrouter = MODELS_DEV_SNAPSHOT.lookup.openrouter;
		expect(Object.keys(openrouter).length).toBeGreaterThan(0);
		const namespaced = Object.keys(openrouter).find((key) => key.includes("/"));
		expect(namespaced).toBeDefined();
		// 网关在上游名字前再叠一层自己的命名空间，仍要能找回来。
		expect(resolveCatalogLookup(MODELS_DEV_SNAPSHOT, `some-gateway/${namespaced}`)?.modelId).toBe(namespaced);
	});
});
