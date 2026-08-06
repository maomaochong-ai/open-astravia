import { describe, expect, it } from "vitest";
import type { FetchImpl } from "./fetch.js";
import {
	CATALOG_TTL_MS,
	enrichFromCatalog,
	fetchModelsDevCatalog,
	isCatalogFresh,
	isCatalogUsable,
	lookupCatalogModel,
	type ModelsDevCatalog,
	selectLatestModels,
} from "./models-dev.js";
import { MODELS_DEV_SNAPSHOT } from "./models-dev-snapshot.generated.js";

const NOW = Date.parse("2026-07-27T00:00:00Z");

const RAW_API_JSON = {
	anthropic: {
		models: {
			"claude-opus-4-8": {
				name: "Claude Opus 4.8",
				reasoning: true,
				reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
				modalities: { input: ["text", "image", "pdf"], output: ["text"] },
				limit: { context: 1000000, output: 128000 },
				cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
			},
		},
	},
	deepseek: {
		models: {
			"deepseek-v4-flash": {
				name: "DeepSeek V4 Flash",
				reasoning: true,
				modalities: { input: ["text"], output: ["text"] },
				limit: { context: 1000000, output: 384000 },
				cost: { input: 0.14, output: 0.28, cache_read: 0.0028 },
			},
		},
	},
	google: {
		models: {
			"gemini-3.5-flash": {
				name: "Gemini 3.5 Flash",
				modalities: { input: ["text", "image"], output: ["text"] },
				limit: { context: 1048576, output: 65536 },
				cost: { input: 1.5, output: 9, cache_read: 0.15 },
			},
			// 视频生成模型:输出模态里没有 text,应当被裁掉。
			"veo-3.1-generate-preview": {
				name: "Veo 3.1",
				modalities: { input: ["text", "image"], output: ["video"] },
			},
		},
	},
	// 不在预设目录里,应当被裁掉。
	somebody: { models: { "x-1": { name: "X" } } },
};

async function fetchCatalog(): Promise<ModelsDevCatalog> {
	const fetchImpl: FetchImpl = async (url) => {
		expect(url).toBe("https://models.dev/api.json");
		return { ok: true, status: 200, statusText: "OK", json: async () => RAW_API_JSON } as Response;
	};
	return fetchModelsDevCatalog(fetchImpl, NOW);
}

describe("models.dev 目录", () => {
	it("只保留预设服务商并折算成 ModelDefinition", async () => {
		const catalog = await fetchCatalog();

		expect(Object.keys(catalog.providers).sort()).toEqual(["claude", "deepseek", "gemini"]);
		// 不吐文本的模型(视频/音乐/图像生成)不进目录。
		expect(Object.keys(catalog.providers.gemini)).toEqual(["gemini-3.5-flash"]);
		expect(catalog.providers.deepseek["deepseek-v4-flash"].model).toEqual({
			id: "deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			reasoning: true,
			input: ["text"],
			contextWindow: 1000000,
			maxTokens: 384000,
			cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
		});
		// pdf 不是我们支持的输入模态,应被过滤;effort 等级转成 reasoningLevels。
		expect(catalog.providers.claude["claude-opus-4-8"].model).toMatchObject({
			input: ["text", "image"],
			reasoningLevels: ["low", "high", "max"],
		});
	});

	it("新鲜度按 12 小时判定", async () => {
		const catalog = await fetchCatalog();

		expect(isCatalogFresh(catalog, NOW)).toBe(true);
		expect(isCatalogFresh(catalog, NOW + CATALOG_TTL_MS - 1)).toBe(true);
		expect(isCatalogFresh(catalog, NOW + CATALOG_TTL_MS)).toBe(false);
		expect(isCatalogFresh(null, NOW)).toBe(false);
	});

	it("旧版本客户端写的缓存一律作废,不管多新鲜", async () => {
		const catalog = await fetchCatalog();
		// v1 的条目直接是模型对象(没有 model/family/releaseDate),读进来会炸在缺失字段上。
		const stale = { fetchedAt: catalog.fetchedAt, providers: { claude: { "claude-x": { id: "claude-x" } } } };

		expect(isCatalogUsable(stale as unknown as ModelsDevCatalog)).toBe(false);
		expect(isCatalogFresh(stale as unknown as ModelsDevCatalog, NOW)).toBe(false);
		expect(isCatalogUsable(catalog)).toBe(true);
	});

	it("查不到精确 id 时退化为去日期后缀与最长前缀匹配", async () => {
		const catalog = await fetchCatalog();

		expect(lookupCatalogModel(catalog, "claude", "claude-opus-4-8-20260204")?.model.id).toBe("claude-opus-4-8");
		expect(lookupCatalogModel(catalog, "claude", "claude-opus-4-8-thinking")?.model.id).toBe("claude-opus-4-8");
		expect(lookupCatalogModel(catalog, "claude", "claude-sonnet-9")).toBeUndefined();
	});

	it("接口给了的字段优先,价格只来自目录", async () => {
		const catalog = await fetchCatalog();

		// 接口自报 200k 上下文与不支持思考,不能被目录覆盖。
		const merged = enrichFromCatalog(catalog, "claude", {
			id: "claude-opus-4-8",
			contextWindow: 200000,
			reasoning: false,
		});

		expect(merged).toMatchObject({
			contextWindow: 200000,
			reasoning: false,
			name: "Claude Opus 4.8",
			input: ["text", "image"],
			cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		});
	});

	it("目录缺失时不编造价格,输入模态兜底为 text", () => {
		const merged = enrichFromCatalog(null, "openai", { id: "gpt-9-unknown" });

		expect(merged).toEqual({ id: "gpt-9-unknown", input: ["text"] });
	});
});

describe("随包内置快照", () => {
	it("schema 版本与当前代码一致——改了 CatalogEntry 形状就必须重新生成", () => {
		// 版本对不上时运行时会整份丢弃,兜底形同虚设,所以这里必须挡住。
		expect(isCatalogUsable(MODELS_DEV_SNAPSHOT)).toBe(true);
	});

	it("每家都有模型,且条目字段齐全", () => {
		expect(Object.keys(MODELS_DEV_SNAPSHOT.providers).sort()).toEqual([
			"claude",
			"deepseek",
			"gemini",
			"grok",
			"kimi",
			"openai",
			"qwen",
			"zai",
		]);
		for (const [presetId, entries] of Object.entries(MODELS_DEV_SNAPSHOT.providers)) {
			expect(Object.keys(entries).length, presetId).toBeGreaterThan(0);
			for (const [id, entry] of Object.entries(entries)) {
				expect(entry.model?.id, `${presetId}/${id}`).toBe(id);
			}
		}
	});

	it("能按系列折叠出最新一档", () => {
		const models = Object.values(MODELS_DEV_SNAPSHOT.providers.claude).map((entry) => entry.model);
		const latest = selectLatestModels(
			MODELS_DEV_SNAPSHOT,
			"claude",
			models,
			Date.parse(MODELS_DEV_SNAPSHOT.fetchedAt),
		);

		expect(latest.length).toBeGreaterThan(0);
		expect(latest.length).toBeLessThan(models.length);
	});
});

describe("selectLatestModels", () => {
	const catalog: ModelsDevCatalog = {
		version: 2,
		fetchedAt: new Date(NOW).toISOString(),
		providers: {
			openai: {
				"gpt-5.6-sol": { model: { id: "gpt-5.6-sol" }, family: "gpt-sol", releaseDate: "2026-07-09" },
				"gpt-5.4": { model: { id: "gpt-5.4" }, family: "gpt-sol", releaseDate: "2026-02-01" },
				"gpt-5.4-mini": { model: { id: "gpt-5.4-mini" }, family: "gpt-mini", releaseDate: "2026-02-01" },
				"gpt-4o": { model: { id: "gpt-4o" }, family: "gpt-4o", releaseDate: "2024-05-13" },
				// 只给到月份,应被归一化后参与比较。
				"gpt-5.5": { model: { id: "gpt-5.5" }, family: "gpt-sol", releaseDate: "2026-04" },
			},
		},
	};
	const ids = (models: Array<{ id: string }>) => models.map((model) => model.id);

	it("每个系列只留发布最新的一档", () => {
		const kept = selectLatestModels(
			catalog,
			"openai",
			[{ id: "gpt-5.6-sol" }, { id: "gpt-5.5" }, { id: "gpt-5.4" }, { id: "gpt-5.4-mini" }],
			NOW,
		);

		expect(ids(kept)).toEqual(["gpt-5.4-mini", "gpt-5.6-sol"]);
	});

	it("发布超过一年的整族淘汰", () => {
		const kept = selectLatestModels(catalog, "openai", [{ id: "gpt-4o" }], NOW);

		expect(kept).toEqual([]);
	});

	it("目录里查不到的模型一律保留——可能是刚发布或账号专属", () => {
		const kept = selectLatestModels(catalog, "openai", [{ id: "gpt-5.4" }, { id: "gpt-7-internal" }], NOW);

		expect(ids(kept)).toEqual(["gpt-5.4", "gpt-7-internal"]);
	});

	it("没有目录时原样返回", () => {
		const models = [{ id: "a" }, { id: "b" }];

		expect(selectLatestModels(null, "openai", models, NOW)).toEqual(models);
	});
});
