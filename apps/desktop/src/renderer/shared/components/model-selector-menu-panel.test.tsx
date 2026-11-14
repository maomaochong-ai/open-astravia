// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

	it("当前模型已收藏时默认停在收藏栏", () => {
		// 不给 initialProviderId 时默认也是收藏栏；这里验证显式传入后同样落在收藏。
		const { container } = setup({
			favoriteKeys: ["anthropic/sonnet"],
			selectedModel: "anthropic/sonnet",
			initialProviderId: "__favorites",
		});
		expect(container.querySelector('[data-model-key="anthropic/sonnet"]')).toBeTruthy();
	});

	it("行内不再画选中对勾：选中态只由底色表达", () => {
		const { container } = setup({ selectedModel: "openai/gpt-5" });
		const row = container.querySelector('[data-model-key="openai/gpt-5"]');
		expect(row?.getAttribute("aria-current")).toBe("true");
		expect(row?.innerHTML).not.toContain("check-circle");
	});

	it("详情入口收进浮层：识图、倍率、默认都在浮层里，且文字可选中", async () => {
		const user = userEvent.setup();
		const { container } = setup({
			labels: {
				...labels,
				infoButton: "模型信息",
				infoProvider: "服务商",
				infoId: "模型 ID",
				infoVision: "识图",
				infoMultiplier: "倍率",
				infoDefault: "默认模型",
				infoYes: "支持",
				infoNo: "不支持",
			},
			defaultKey: "openai/gpt-5",
		});
		const row = container.querySelector('[data-model-key="openai/gpt-5"]');
		// 行内不再直接排识图/默认标识，只有名字与两个按钮。
		expect(row?.textContent).toBe("GPT-5");

		await user.click(screen.getByRole("button", { name: "模型信息：GPT-5" }));
		const panel = await screen.findByText("模型 ID");
		const content = panel.closest('[data-slot="popover-content"]');
		expect(content?.className).toContain("select-text");
		// 标签在上、值在下：dt 与 dd 是同一行容器里的两层。
		expect(content?.querySelector("dt")?.textContent).toBe("服务商");
		expect(content?.querySelector("dd")?.textContent).toBe("OpenAI");
		expect(content?.textContent).toContain("不支持");
	});

	it("服务商过多时左栏折叠，展开后能看到其余服务商", () => {
		const many = Array.from({ length: 10 }, (_, index) => ({
			provider: `p${index}`,
			label: `Provider ${index}`,
			models: [{ key: `p${index}/m`, provider: `p${index}`, modelId: "m", displayName: `M${index}` }],
		}));
		const { container } = setup({ groups: many });
		const firstColumn = container.querySelector('[role="group"]');
		expect(firstColumn?.textContent).not.toContain("Provider 9");
		fireEvent.click(screen.getByRole("button", { name: /\+3/ }));
		expect(container.querySelector('[role="group"]')?.textContent).toContain("Provider 9");
	});
});
