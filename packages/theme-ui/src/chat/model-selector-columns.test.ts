import { describe, expect, it } from "vitest";
import type { ModelSelectorProviderGroup } from "./ModelSelectorView";
import {
	buildModelColumns,
	computeVirtualRange,
	FAVORITES_COLUMN_ID,
	normalizeModelSearch,
	parseModelFavorites,
	serializeModelFavorites,
	toggleModelFavorite,
} from "./model-selector-columns";

function model(
	key: string,
	provider: string,
	displayName = key,
): { key: string; provider: string; modelId: string; displayName: string } {
	return { key, provider, modelId: key.split("/")[1] ?? key, displayName };
}

const groups: ModelSelectorProviderGroup[] = [
	{
		provider: "openai",
		label: "OpenAI",
		models: [model("openai/gpt-5", "openai", "GPT-5"), model("openai/o4", "openai", "o4")],
	},
	{
		provider: "anthropic",
		label: "Anthropic",
		models: [model("anthropic/sonnet", "anthropic", "Sonnet 4.5")],
	},
];

/**
 * 三栏的第一、二栏。搜索与不搜索是两种模式，行为不同：
 * 不搜索按服务商收敛；搜索跨服务商平铺并标注来源。
 */
describe("模型菜单三栏", () => {
	it("没有收藏时不出现收藏栏，默认选中第一个服务商", () => {
		const columns = buildModelColumns(groups, { favorites: [], query: "" });
		expect(columns.providers.map((column) => column.id)).toEqual(["openai", "anthropic"]);
		expect(columns.activeProviderId).toBe("openai");
		expect(columns.models.map((entry) => entry.model.key)).toEqual(["openai/gpt-5", "openai/o4"]);
	});

	it("有收藏时收藏栏排最前并被默认选中", () => {
		const columns = buildModelColumns(groups, { favorites: ["anthropic/sonnet"], query: "" });
		expect(columns.providers[0]?.id).toBe(FAVORITES_COLUMN_ID);
		expect(columns.activeProviderId).toBe(FAVORITES_COLUMN_ID);
		expect(columns.models.map((entry) => entry.model.key)).toEqual(["anthropic/sonnet"]);
	});

	it("收藏里已经不存在的模型自动消失，不留空壳栏", () => {
		const columns = buildModelColumns(groups, { favorites: ["gone/model"], query: "" });
		expect(columns.providers.map((column) => column.id)).toEqual(["openai", "anthropic"]);
	});

	it("搜索跨服务商平铺，并带来源服务商名", () => {
		const columns = buildModelColumns(groups, { favorites: [], query: "son" });
		expect(columns.searching).toBe(true);
		expect(columns.activeProviderId).toBeNull();
		expect(columns.models.map((entry) => entry.model.key)).toEqual(["anthropic/sonnet"]);
		expect(columns.models[0]?.providerLabel).toBe("Anthropic");
	});

	it("搜索不区分大小写与首尾空格", () => {
		expect(normalizeModelSearch("  SoN  ")).toBe("son");
		expect(buildModelColumns(groups, { favorites: [], query: "  GPT " }).models).toHaveLength(1);
	});

	it("搜索也匹配标签", () => {
		const withTags: ModelSelectorProviderGroup[] = [
			{
				provider: "x",
				label: "X",
				models: [{ ...model("x/a", "x"), tags: ["视觉"] }],
			},
		];
		expect(buildModelColumns(withTags, { favorites: [], query: "视觉" }).models).toHaveLength(1);
	});
});

describe("模型列表虚拟滚动", () => {
	it("少于阈值时全量渲染（窗口化收益抵不上焦点与锚点问题）", () => {
		expect(computeVirtualRange({ scrollTop: 0, viewportHeight: 300, rowHeight: 28, count: 30 })).toEqual({
			start: 0,
			end: 30,
			paddingTop: 0,
			paddingBottom: 0,
		});
	});

	it("超过阈值时只渲染可见区间与上下缓冲", () => {
		const range = computeVirtualRange({ scrollTop: 280, viewportHeight: 280, rowHeight: 28, count: 500 });
		// 280 / 28 = 第 10 行起；向上 4 行缓冲 → start 6；可视 11 行 + 4 行缓冲 → end 25。
		expect(range.start).toBe(6);
		expect(range.end).toBe(25);
		expect(range.paddingTop).toBe(6 * 28);
		expect(range.paddingBottom).toBe((500 - 25) * 28);
	});

	it("滚到底时不越界", () => {
		const range = computeVirtualRange({ scrollTop: 100_000, viewportHeight: 280, rowHeight: 28, count: 80 });
		expect(range.end).toBe(80);
		expect(range.paddingBottom).toBe(0);
	});

	it("行高为 0 时退回全量渲染，而不是除零", () => {
		expect(computeVirtualRange({ scrollTop: 100, viewportHeight: 300, rowHeight: 0, count: 100 }).end).toBe(100);
	});
});

describe("模型收藏", () => {
	it("切换：未收藏则追加、已收藏则移除", () => {
		expect(toggleModelFavorite([], "a")).toEqual(["a"]);
		expect(toggleModelFavorite(["a", "b"], "a")).toEqual(["b"]);
	});

	it("坏数据回落空数组", () => {
		expect(parseModelFavorites(undefined)).toEqual([]);
		expect(parseModelFavorites("not json")).toEqual([]);
		expect(parseModelFavorites(JSON.stringify({ a: 1 }))).toEqual([]);
	});

	it("去重并保持加入顺序", () => {
		expect(parseModelFavorites(JSON.stringify(["b", "a", "b"]))).toEqual(["b", "a"]);
	});

	it("序列化后可原样解析", () => {
		const favorites = ["openai/gpt-5", "anthropic/sonnet"];
		expect(parseModelFavorites(serializeModelFavorites(favorites))).toEqual(favorites);
	});
});
