// @vitest-environment jsdom

import { QueueCardView } from "@astravia-org/theme-ui/chat";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddPanelSection } from "./add-panel-catalog";
import { CommandPanelView } from "./CommandPanelView";
import type { CommandPanelLabels, CommandPanelPreviewModel } from "./types";

class ResizeObserverStub {
	observe(): void {}
	disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// 这个环境没有开 Testing Library 的自动清理，同一文件里的多次 render 会互相污染。
afterEach(cleanup);

function makeLabels(): CommandPanelLabels {
	return {
		searchPlaceholder: "搜索技能、连接器、插件、应用…",
		clearSearch: "清空搜索",
		favorites: "收藏",
		favoritesEmpty: "还没有收藏",
		favoritesEmptyHint: "在任意条目上悬停并点星标",
		categories: "添加分类",
		operations: "操作",
		openAbilityPlaza: "能力广场",
		categoryLabel: (tab) => {
			if (tab === "favorites") return "收藏";
			if (tab === "all") return "全部";
			if (tab === "operations") return "操作";
			return { files: "文件", skills: "技能", connectors: "连接器", plugins: "插件", apps: "应用" }[tab];
		},
		groupLabel: (key) => key,
		all: "全部",
		categoryEmpty: (category: string) => `${category}里还没有内容`,
		operationsEmptyHint: "当前会话还没有可用的操作",
		emptyNoMatch: "未找到匹配项",
		emptyNoMatchHint: "换个关键词试试",
		emptyNoSkills: "暂无可用的技能",
		emptyNoSkillsHint: "去能力广场安装技能",
		favoriteAdd: "收藏",
		favoriteRemove: "取消收藏",
		details: "详情",
		preview: {
			back: "返回列表",
			sourceLabel: "来源",
			statusLabel: "状态",
			statusConnected: "已连接",
			insertLabel: "插入",
		},
		hints: {
			scrollToolsLeft: "向左查看更多工具",
			scrollToolsRight: "向右查看更多工具",
			scrollRailUp: "向上翻更多分类",
			scrollRailDown: "向下翻更多分类",
		},
	};
}

const SKILL_SECTION: AddPanelSection = {
	category: "skills",
	titleKey: "slashPanel.sections.skills",
	groups: [
		{
			id: "builtin",
			titleKey: "内置",
			entries: [
				{
					category: "skills",
					id: "skill:code-review",
					key: "skills:skill:code-review",
					label: "代码审阅",
					description: "按仓库标准审阅改动",
					groupId: "builtin",
					searchable: true,
					fallbackIcon: "icon-[solar--magic-stick-3-linear]",
				},
				{
					category: "skills",
					id: "skill:diagnose",
					key: "skills:skill:diagnose",
					label: "缺陷诊断",
					groupId: "builtin",
					searchable: true,
					fallbackIcon: "icon-[solar--magic-stick-3-linear]",
				},
			],
		},
	],
};

const PREVIEW: CommandPanelPreviewModel = {
	key: "skills:skill:code-review",
	label: "代码审阅",
	subtitle: "技能 · 内置",
	description: "按仓库标准审阅改动",
	fallbackIcon: "icon-[solar--magic-stick-3-linear]",
	meta: [{ label: "来源", value: "内置" }],
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof CommandPanelView>> = {}) {
	const props: React.ComponentProps<typeof CommandPanelView> = {
		open: true,
		tab: "skills",
		query: "",
		sections: [SKILL_SECTION],
		activeKey: "skills:skill:code-review",
		scrollSignal: 0,
		favorites: [],
		preview: null,
		searching: false,
		actions: [],
		labels: makeLabels(),
		panelRef: createRef<HTMLDivElement>(),
		onSelectTab: vi.fn(),
		onQueryChange: vi.fn(),
		onActivateEntry: vi.fn(),
		onOpenPreview: vi.fn(),
		onClosePreview: vi.fn(),
		onToggleFavorite: vi.fn(),
		onPanelKeyDown: vi.fn(),
		...overrides,
	};
	return { ...render(<CommandPanelView {...props} />), props };
}

describe("CommandPanelView 两栏面板", () => {
	it("左栏固定五类 + 收藏，点一下切分类", () => {
		const { props } = renderPanel();
		const tabs = screen.getAllByRole("tab");
		// 收藏 + 全部 + 文件 / 技能 / 连接器 / 插件 / 应用 + 操作：位置固定，空的也留在轨道上
		expect(tabs).toHaveLength(8);
		expect(screen.getByRole("tab", { name: "插件" })).toBeTruthy();
		fireEvent.click(screen.getByRole("tab", { name: "连接器" }));
		expect(props.onSelectTab).toHaveBeenCalledWith("connectors");
	});

	it("行只有名字，点行即插入、点星标只收藏、点详情只开预览", () => {
		const { props } = renderPanel();
		const rows = screen.getAllByRole("option");
		expect(rows.map((row) => row.textContent)).toEqual(["代码审阅", "缺陷诊断"]);

		fireEvent.click(screen.getByText("缺陷诊断"));
		expect(props.onActivateEntry).toHaveBeenCalledWith("skills:skill:diagnose");

		fireEvent.click(screen.getAllByRole("button", { name: "收藏" })[0]);
		expect(props.onToggleFavorite).toHaveBeenCalledWith("skills:skill:code-review");
		expect(props.onActivateEntry).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getAllByRole("button", { name: "详情" })[0]);
		expect(props.onOpenPreview).toHaveBeenCalledWith("skills:skill:code-review");
		expect(props.onActivateEntry).toHaveBeenCalledTimes(1);
	});

	it("悬停不触发滚动：高亮变化不会把列表推走", () => {
		const { container } = renderPanel();
		const list = container.querySelector('[role="listbox"]') as HTMLDivElement;
		Object.defineProperty(list, "scrollTop", { value: 0, writable: true });

		fireEvent.mouseEnter(screen.getByText("缺陷诊断"));

		// 回归：以前滚动副作用挂在 activeKey 上，hover 也会触发自动滚动。
		expect(list.scrollTop).toBe(0);
	});

	it("预览态占满中栏、给完整描述，且没有插入按钮", () => {
		const { props } = renderPanel({ preview: PREVIEW, onOpenPreview: vi.fn() });
		// 描述在预览里完整可见
		expect(screen.getByText("按仓库标准审阅改动")).toBeTruthy();
		// 回归：预览页不再有那行「点击这一行即可插入…」的提示。
		expect(screen.queryByText(/点击这一行即可插入/)).toBeNull();
		// 三栏时的「插入到输入框」已删除：插入就是点列表那一行
		expect(screen.queryByRole("button", { name: /插入到输入框/ })).toBeNull();
		// 预览里没有列表与搜索框
		expect(screen.queryByRole("listbox")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
		expect(props.onClosePreview).toHaveBeenCalledOnce();
	});

	it("搜索无结果时显示空态而不是列表", () => {
		renderPanel({ sections: [], activeKey: null, preview: null, searching: true });
		expect(screen.getByText("未找到匹配项")).toBeTruthy();
	});

	it("只有一个来源分组时不出分组头，搜索态改出分类分组头", () => {
		const { rerender } = renderPanel();
		expect(screen.queryByText("内置")).toBeNull();

		rerender(
			<CommandPanelView
				open
				tab="skills"
				query="代码"
				sections={[SKILL_SECTION]}
				activeKey="skills:skill:code-review"
				scrollSignal={0}
				favorites={[]}
				preview={null}
				searching
				actions={[]}
				labels={makeLabels()}
				panelRef={createRef<HTMLDivElement>()}
				onSelectTab={vi.fn()}
				onQueryChange={vi.fn()}
				onActivateEntry={vi.fn()}
				onOpenPreview={vi.fn()}
				onClosePreview={vi.fn()}
				onToggleFavorite={vi.fn()}
				onPanelKeyDown={vi.fn()}
			/>,
		);
		expect(screen.getByText("技能")).toBeTruthy();
	});

	it("压缩上下文是「操作」分类里的一行，带真实占比圆环", () => {
		const onSelect = vi.fn();
		const { container } = renderPanel({
			tab: "operations",
			sections: [],
			activeKey: null,
			preview: null,
			operation: {
				id: "compact",
				label: "压缩上下文",
				description: "压缩此聊天的上下文（已使用 60%）",
				contextRing: { percent: 60, offset: 16, color: "var(--primary)", isCompacting: false, tooltip: "60%" },
				disabled: false,
				onSelect,
			},
		});

		const button = screen.getByRole("button", { name: /压缩上下文/ });
		expect(container.querySelector("svg")).not.toBeNull();
		fireEvent.click(button);
		expect(onSelect).toHaveBeenCalledOnce();
	});
});

describe("CommandPanelView 与压缩队列的既有契约", () => {
	it("压缩队列项保留删除与拖动入口，但不提供会中立即发送", () => {
		const onSendNow = vi.fn();
		const onRemove = vi.fn();
		render(
			<QueueCardView
				items={[{ id: "compact-1", kind: "context_compaction", displayText: "压缩上下文" }]}
				labels={{ empty: "空", sendNow: "立即发送", delete: "删除", recall: "撤回到输入框", guide: "引导" }}
				onReorder={vi.fn()}
				onSendNow={onSendNow}
				onRemove={onRemove}
				onRecall={vi.fn()}
				onGuide={vi.fn()}
			/>,
		);

		expect(screen.queryByTitle("立即发送")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "删除" }));
		expect(onRemove).toHaveBeenCalledWith("compact-1");
		expect(onSendNow).not.toHaveBeenCalled();
	});
});
