// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelectorMenuPanel } from "@astravia-org/theme-ui/chat/ModelSelectorMenuPanel";
import type { ModelSelectorLabels } from "@astravia-org/theme-ui/chat/ModelSelectorView";

afterEach(cleanup);

const labels: ModelSelectorLabels = {
	placeholder: "选择模型",
	searchPlaceholder: "搜索模型",
	clearSearch: "清除",
	noResults: "没有匹配的模型",
	noResultsHint: "换个关键词试试",
	reasoningHeader: "思考强度",
	modelHeader: "模型",
	cloudOnly: "云端",
	visionBadge: "支持图片",
	defaultBadge: "默认",
	favoritesHeader: "收藏",
	favorite: "收藏",
	unfavorite: "取消收藏",
	searchResultsHeader: "搜索结果",
	levelLabel: (value) => value,
};

const groups = [
	{
		provider: "openai",
		label: "OpenAI",
		models: [
			{ key: "openai/gpt-5", provider: "openai", modelId: "gpt-5", displayName: "GPT-5" },
			{ key: "openai/o4", provider: "openai", modelId: "o4", displayName: "o4" },
		],
	},
	{
		provider: "anthropic",
		label: "Anthropic",
		models: [{ key: "anthropic/sonnet", provider: "anthropic", modelId: "sonnet", displayName: "Sonnet 4.5" }],
	},
];

/**
 * 三栏面板的用户动作：换服务商只换中间栏、收藏进第一栏第一格、点模型回调一次。
 * 这些是「找模型」流程里最常走的几步，断言的是可见结果而不是内部状态。
 */
describe("模型菜单三栏", () => {
	function setup(overrides: Partial<React.ComponentProps<typeof ModelSelectorMenuPanel>> = {}) {
		const onSelectModel = vi.fn();
		const onSelectReasoning = vi.fn();
		const onToggleFavorite = vi.fn();
		const { container } = render(
			<ModelSelectorMenuPanel
				groups={groups}
				labels={labels}
				favoriteKeys={[]}
				searchQuery=""
				menuLevels={[]}
				onSelectModel={onSelectModel}
				onSelectReasoning={onSelectReasoning}
				onToggleFavorite={onToggleFavorite}
				{...overrides}
			/>,
		);
		return { container, onSelectModel, onSelectReasoning, onToggleFavorite };
	}

	it("默认显示第一个服务商的模型，点另一个服务商换整栏", () => {
		const { container } = setup();
		expect(container.querySelector('[data-model-key="openai/gpt-5"]')).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Anthropic/ }));
		expect(container.querySelector('[data-model-key="anthropic/sonnet"]')).toBeTruthy();
		expect(container.querySelector('[data-model-key="openai/gpt-5"]')).toBeNull();
	});

	it("点模型只回调一次，且带的是模型 key", () => {
		const { onSelectModel, container } = setup();
		const row = container.querySelector('[data-model-key="openai/gpt-5"]');
		// 行里的第一个按钮是「选中这个模型」，第二个是星标。
		fireEvent.click(row!.querySelectorAll("button")[0]!);
		expect(onSelectModel).toHaveBeenCalledWith("openai/gpt-5");
		expect(onSelectModel).toHaveBeenCalledTimes(1);
	});

	it("星标点击切换收藏，且不触发选中模型", () => {
		const { onSelectModel, onToggleFavorite } = setup();
		fireEvent.click(screen.getByRole("button", { name: "收藏：GPT-5" }));
		expect(onToggleFavorite).toHaveBeenCalledWith("openai/gpt-5");
		expect(onSelectModel).not.toHaveBeenCalled();
	});

	it("有收藏时服务商栏第一格是收藏，并显示其中的模型", () => {
		const { container } = setup({ favoriteKeys: ["anthropic/sonnet"] });
		// 第一栏的第一格是收藏（带星标图标），中间栏此时只列出收藏里的模型。
		const firstColumn = container.querySelector('[role="group"]');
		expect(firstColumn?.textContent).toContain("收藏");
		expect(container.querySelectorAll('[data-model-key]')).toHaveLength(1);
		expect(container.querySelector('[data-model-key="anthropic/sonnet"]')).toBeTruthy();
	});

	it("没有思考档位时不渲染第三栏", () => {
		setup();
		expect(screen.queryByRole("group", { name: "思考强度" })).toBeNull();
	});

	it("有档位时第三栏可点，回调带档位值", () => {
		const { onSelectReasoning } = setup({ menuLevels: ["low", "high"], currentLevel: "low" });
		expect(screen.getByRole("group", { name: "思考强度" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "high" }));
		expect(onSelectReasoning).toHaveBeenCalledWith("high");
	});

	it("搜索时跨服务商平铺并标注来源", () => {
		const { container } = setup({ searchQuery: "sonnet" });
		const row = container.querySelector('[data-model-key="anthropic/sonnet"]');
		expect(row?.textContent).toContain("Anthropic");
	});

	it("搜索无结果时给出空态", () => {
		setup({ searchQuery: "zzzz" });
		expect(screen.getByText("没有匹配的模型")).toBeTruthy();
	});
});
