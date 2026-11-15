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
	favoritesEmpty: "还没有收藏的模型",
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

	it("收藏列常驻：没有收藏时第一栏仍有星标格，点进去是专属空态", () => {
		const { container } = setup({ favoriteKeys: [] });
		const firstCell = container.querySelector('[role="group"] button');
		expect(firstCell?.getAttribute("aria-label")).toBe("收藏");
		// 点收藏格进入空收藏：显示专属空态而不是「未找到模型」。
		fireEvent.click(firstCell!);
		expect(screen.getByText("还没有收藏的模型")).toBeTruthy();
		expect(screen.queryByText("没有匹配的模型")).toBeNull();
	});

	it("星标常驻：每行都有收藏按钮，已收藏的实心金星、未收藏的空星", () => {
		// 默认会落在收藏栏（只有已收藏那一行）；显式停在 openai 栏才能同时看到已收藏与未收藏两行。
		const { container } = setup({ favoriteKeys: ["openai/gpt-5"], initialProviderId: "openai" });
		const rows = container.querySelectorAll("[data-model-key]");
		// 每一行都有一颗星标按钮，不存在「悬停才出现」的隐藏态。
		for (const row of rows) {
			expect(row.querySelector('button[aria-pressed]')).toBeTruthy();
		}
		const favorited = container.querySelector('[data-model-key="openai/gpt-5"] button[aria-pressed="true"]');
		const unfavorited = container.querySelector('[data-model-key="openai/o4"] button[aria-pressed="false"]');
		expect(favorited?.className).toContain("text-amber-500");
		expect(unfavorited?.className).not.toContain("hidden");
	});

	it("中栏顶部显示当前服务商小标题，换服务商跟着变", () => {
		const { container } = setup();
		// 默认落在第一个服务商，第二栏顶部的小标题就是它的名字。
		const list = container.querySelector('[role="listbox"]');
		expect(list?.querySelector("p")?.textContent).toBe("OpenAI");
		fireEvent.click(screen.getByRole("button", { name: /Anthropic/ }));
		expect(list?.querySelector("p")?.textContent).toBe("Anthropic");
	});

	it("星标点击切换收藏，且不触发选中模型", () => {
		const { onSelectModel, onToggleFavorite } = setup();
		fireEvent.click(screen.getByRole("button", { name: "收藏：GPT-5" }));
		expect(onToggleFavorite).toHaveBeenCalledWith("openai/gpt-5");
		expect(onSelectModel).not.toHaveBeenCalled();
	});

	it("有收藏时服务商栏第一格是收藏，并显示其中的模型", () => {
		const { container } = setup({ favoriteKeys: ["anthropic/sonnet"] });
		// 第一栏的第一格是收藏（纯图标星标，名称在 aria-label 里），中间栏只列出收藏里的模型。
		const firstCell = container.querySelector('[role="group"] button');
		expect(firstCell?.getAttribute("aria-label")).toBe("收藏");
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
		// 轨道是纯图标：名字在 aria-label 里。常驻的收藏格占第一格，收起来时是「收藏 + 6 个服务商」+ 一个折叠钮。
		const providerButtons = (): number =>
			Array.from(firstColumn?.querySelectorAll("button") ?? []).filter((b) =>
				/^Provider \d+$/.test(b.getAttribute("aria-label") ?? ""),
			).length;
		expect(providerButtons()).toBe(6);
		expect(screen.getByRole("button", { name: /\+4/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /\+4/ }));
		expect(providerButtons()).toBe(10);
	});
});
