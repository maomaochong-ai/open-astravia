import { describe, expect, it } from "vitest";
import type { FetchImpl } from "./fetch.js";
import {
	buildCatalog,
	CATALOG_TTL_MS,
	enrichFromCatalog,
	enrichModelsFromCatalog,
	fetchModelsDevCatalog,
	isCatalogFresh,
	isCatalogUsable,
	lookupCatalogModel,
	type ModelsDevCatalog,
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
			"claude-3-opus": {
				name: "Claude 3 Opus",
				status: "deprecated",
				modalities: { input: ["text"], output: ["text"] },
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
	it("被同档位新一代取代的模型标为历史,当代不标", async () => {
		const catalog = buildCatalog(
			{
				anthropic: {
					models: {
						"claude-opus-5": {
							family: "claude-opus",
							release_date: "2026-07-24",
							modalities: { output: ["text"] },
						},
						"claude-opus-4-8": {
							family: "claude-opus",
							release_date: "2026-05-28",
							modalities: { output: ["text"] },
						},
					},
				},
			},
			NOW,
		);

		expect(catalog.providers.claude["claude-opus-5"].legacy).toBeUndefined();
		expect(catalog.providers.claude["claude-opus-4-8"].legacy).toBe(true);
	});

	it("只保留预设服务商并折算成 ModelDefinition", async () => {
		const catalog = await fetchCatalog();

		expect(Object.keys(catalog.providers).sort()).toEqual(["claude", "deepseek", "gemini"]);
		// 不吐文本的模型(视频/音乐/图像生成)不进目录。
		expect(Object.keys(catalog.providers.gemini)).toEqual(["gemini-3.5-flash"]);
		// 上游明确标记 deprecated 的文本模型也不应继续出现在公共目录。
		expect(catalog.providers.claude["claude-3-opus"]).toBeUndefined();
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

	it("每家都有可选的当前模型——代际收敛不能把整家清空", () => {
		// 收敛规则误伤时最坏的表现是某家只剩历史模型,用户打开设置页看到空列表还以为目录拉挂了。
		for (const [presetId, entries] of Object.entries(MODELS_DEV_SNAPSHOT.providers)) {
			const current = Object.values(entries).filter((entry) => !entry.legacy);
			expect(current.length, presetId).toBeGreaterThan(0);
		}
	});

	it("被新一代取代的模型标为历史,当代与无继任者的档位保留", () => {
		const claude = MODELS_DEV_SNAPSHOT.providers.claude;
		const openai = MODELS_DEV_SNAPSHOT.providers.openai;

		// o 系列早被 gpt-5 系列取代,上游却一直没标 deprecated——正是收敛要处理的那批。
		expect(openai.o3?.legacy).toBe(true);
		// Haiku 4.5 没有继任者,仍是该档唯一在售选项,不能被收进历史。
		expect(claude["claude-haiku-4-5"]?.legacy).toBeUndefined();
		expect(claude["claude-sonnet-4-5"]?.legacy).toBe(true);
	});

	it("目录中的可用模型不会再按系列折叠", () => {
		const models = Object.values(MODELS_DEV_SNAPSHOT.providers.claude).map((entry) => entry.model);
		const enriched = enrichModelsFromCatalog(MODELS_DEV_SNAPSHOT, "claude", models);

		expect(enriched).toHaveLength(models.length);
	});
});

describe("enrichModelsFromCatalog", () => {
	const ids = (models: Array<{ id: string }>) => models.map((model) => model.id);

	it("同一 family 的不同服务档位和目录未知模型全部保留", () => {
		const catalog = buildCatalog(
			{
				alibaba: {
					models: {
						"qwen3-max": { name: "Qwen3 Max", family: "qwen", modalities: { output: ["text"] } },
						"qwen3-plus": { name: "Qwen3 Plus", family: "qwen", modalities: { output: ["text"] } },
						"qwen3-flash": { name: "Qwen3 Flash", family: "qwen", modalities: { output: ["text"] } },
					},
				},
			},
			NOW,
		);
		const models = [{ id: "qwen3-plus" }, { id: "qwen-account-preview" }, { id: "qwen3-flash" }, { id: "qwen3-max" }];

		const kept = enrichModelsFromCatalog(catalog, "qwen", models);

		expect(ids(kept)).toEqual(["qwen-account-preview", "qwen3-flash", "qwen3-max", "qwen3-plus"]);
		expect(kept.find((model) => model.id === "qwen3-max")?.name).toBe("Qwen3 Max");
	});

	it("按发布日期倒序排,新的在前", () => {
		// 按 id 字典序排会把 gpt-6-astra 甩到 gpt-5.3-codex 后面,而用户来选模型时要的几乎总是最新那批。
		const catalog = buildCatalog(
			{
				openai: {
					models: {
						"gpt-6-astra": { family: "gpt-astra", release_date: "2026-09-04", modalities: { output: ["text"] } },
						"gpt-5.3-codex": {
							family: "gpt-codex",
							release_date: "2026-02-05",
							modalities: { output: ["text"] },
						},
						"gpt-5.6": { family: "gpt-sol", release_date: "2026-07-09", modalities: { output: ["text"] } },
					},
				},
			},
			NOW,
		);
		const models = [{ id: "gpt-5.3-codex" }, { id: "gpt-6-astra" }, { id: "gpt-5.6" }];

		expect(ids(enrichModelsFromCatalog(catalog, "openai", models))).toEqual([
			"gpt-6-astra",
			"gpt-5.6",
			"gpt-5.3-codex",
		]);
	});

	it("目录里查不到发布日期的模型排在最后", () => {
		// 账号接口返回、目录还没收录的新模型没有可比依据,但也不该插进有日期的序列里。
		const catalog = buildCatalog(
			{
				openai: {
					models: {
						"gpt-5.6": { family: "gpt-sol", release_date: "2026-07-09", modalities: { output: ["text"] } },
					},
				},
			},
			NOW,
		);
		const models = [{ id: "zz-account-only" }, { id: "aa-account-only" }, { id: "gpt-5.6" }];

		expect(ids(enrichModelsFromCatalog(catalog, "openai", models))).toEqual([
			"gpt-5.6",
			"aa-account-only",
			"zz-account-only",
		]);
	});

	it("没有目录时仍保留并按 id 排序", () => {
		const models = [{ id: "b" }, { id: "a" }];

		expect(ids(enrichModelsFromCatalog(null, "openai", models))).toEqual(["a", "b"]);
	});
});
