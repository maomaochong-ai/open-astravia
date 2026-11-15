// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueueCardView } from "@astravia-org/theme-ui/chat";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddPanelSection } from "./add-panel-catalog";
import { CommandPanelView } from "./CommandPanelView";
import type { CommandPanelDetailModel, CommandPanelLabels } from "./types";

class ResizeObserverStub {
	observe(): void {}
	disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// 这个环境没有开 Testing Library 的自动清理，同一文件里的多次 render 会互相污染。
afterEach(cleanup);

function makeLabels(): CommandPanelLabels {
	const detail = {
		insert: "插入到输入框",
		execute: "执行",
		connect: "连接",
		configure: "配置",
		disconnect: "断开连接",
		viewPermissions: "查看权限",
		enable: "启用",
		disable: "停用",
		viewInPlaza: "在能力广场中查看",
		viewDetails: "查看详情",
		sourceLabel: "来源",
		statusLabel: "状态",
		insertLabel: "插入",
		hintSkill: "插入后会留下提示词标签",
		hintConnector: "连接后工具由 Agent 直接调用",
		hintFile: "直接作用于当前消息",
		hintExtension: "启用后技能会出现在技能分类",
		statusConnected: "已连接",
		statusDisconnected: "未连接",
		statusEnabled: "已启用",
		statusDisabled: "已停用",
		statusPublished: "已发布",
		statusDraft: "草稿",
	};
	return {
		searchPlaceholder: "搜索技能、连接器、插件、应用…",
		clearSearch: "清空搜索",
		favorites: "收藏",
		favoritesEmpty: "还没有收藏",
		favoritesEmptyHint: "在任意条目上悬停并点星标",
		categories: "添加分类",
		openAbilityPlaza: "能力广场",
		categoryLabel: (tab) => {
			if (tab === "favorites") return "收藏";
			return { files: "文件", skills: "技能", connectors: "连接器", plugins: "插件", apps: "应用" }[tab];
		},
		groupLabel: (key) => key,
		categoryEmpty: "这一类还没有条目",
		emptyNoMatch: "未找到匹配项",
		emptyNoMatchHint: "换个关键词试试",
		emptyNoSkills: "暂无可用的技能",
		emptyNoSkillsHint: "去能力广场安装技能",
		favoriteAdd: "收藏",
		favoriteRemove: "取消收藏",
		details: "详情",
		detail,
		hints: { navigate: "选择", select: "选中", tab: "切换分类", insert: "插入", close: "关闭" },
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
				},
				{
					category: "skills",
					id: "skill:diagnose",
					key: "skills:skill:diagnose",
					label: "缺陷诊断",
					groupId: "builtin",
					searchable: true,
				},
			],
		},
	],
};

const DETAIL: CommandPanelDetailModel = {
	key: "skills:skill:code-review",
	label: "代码审阅",
	subtitle: "skills · 内置",
	description: "按仓库标准审阅改动",
	meta: [{ label: "来源", value: "内置" }],
	hint: "插入后会留下提示词标签",
	primaryLabel: "插入到输入框",
	secondaryLabel: "在能力广场中查看",
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof CommandPanelView>> = {}) {
	const props: React.ComponentProps<typeof CommandPanelView> = {
		open: true,
		tab: "skills",
		query: "",
		sections: [SKILL_SECTION],
		visibleKeys: ["skills:skill:code-review", "skills:skill:diagnose"],
		activeKey: "skills:skill:code-review",
		favorites: [],
		detail: DETAIL,
		searching: false,
		actions: [],
		labels: makeLabels(),
		panelRef: createRef<HTMLDivElement>(),
		onSelectTab: vi.fn(),
		onQueryChange: vi.fn(),
		onHoverEntry: vi.fn(),
		onActivateEntry: vi.fn(),
		onToggleFavorite: vi.fn(),
		...overrides,
	};
	return { ...render(<CommandPanelView {...props} />), props };
}

describe("CommandPanelView 三栏面板", () => {
	it("左栏是固定分类轨道，点击切换分类", () => {
		const { props } = renderPanel();
		const tabs = screen.getAllByRole("tab");
		// 收藏 + 文件 / 技能 / 连接器 / 插件 / 应用
		expect(tabs).toHaveLength(6);
		fireEvent.click(screen.getByRole("tab", { name: "连接器" }));
		expect(props.onSelectTab).toHaveBeenCalledWith("connectors");
	});

	it("行上只有名字：点击插入、星标收藏、详情只改高亮", () => {
		const { props } = renderPanel();
		// 名字在列表行与右栏详情里各出现一次；这里要断言的是「列表行只有名字」。
		const row = screen
			.getAllByText("代码审阅")
			.map((node) => node.closest('[role="option"]'))
			.find((node) => node !== null);
		expect(row?.textContent).toBe("代码审阅");

		fireEvent.click(screen.getByText("缺陷诊断"));
		expect(props.onActivateEntry).toHaveBeenCalledWith("skills:skill:diagnose");

		fireEvent.click(screen.getAllByRole("button", { name: "收藏" })[0]);
		expect(props.onToggleFavorite).toHaveBeenCalledWith("skills:skill:code-review");

		fireEvent.click(screen.getAllByRole("button", { name: "详情" })[0]);
		expect(props.onHoverEntry).toHaveBeenCalledWith("skills:skill:code-review");
	});

	it("没有高亮项时右栏整栏不渲染，不留空白列", () => {
		renderPanel({ detail: null });
		expect(screen.queryByText("按仓库标准审阅改动")).toBeNull();
		expect(screen.queryByRole("button", { name: /插入到输入框/ })).toBeNull();
	});

	it("搜索无结果时显示空态而不是列表", () => {
		renderPanel({ sections: [], visibleKeys: [], activeKey: null, detail: null, searching: true });
		expect(screen.getByText("未找到匹配项")).toBeTruthy();
	});

	it("搜索态用分类名做分组头，分类视图里只有一个来源分组时不出现分组头", () => {
		const { rerender } = renderPanel({ searching: true });
		expect(screen.getByText("技能")).toBeTruthy();

		rerender(
			<CommandPanelView
				open
				tab="skills"
				query=""
				sections={[SKILL_SECTION]}
				visibleKeys={["skills:skill:code-review"]}
				activeKey="skills:skill:code-review"
				favorites={[]}
				detail={null}
				searching={false}
				actions={[]}
				labels={makeLabels()}
				panelRef={createRef<HTMLDivElement>()}
				onSelectTab={vi.fn()}
				onQueryChange={vi.fn()}
				onHoverEntry={vi.fn()}
				onActivateEntry={vi.fn()}
				onToggleFavorite={vi.fn()}
			/>,
		);
		expect(screen.queryByText("内置")).toBeNull();
	});

	it("在列表顶部渲染可访问的压缩操作和真实占比圆环", () => {
		const onSelect = vi.fn();
		const { container } = renderPanel({
			activeKey: null,
			detail: null,
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

	it("详情栏的次要动作只在有回调时出现", () => {
		renderPanel();
		expect(screen.queryByRole("button", { name: "在能力广场中查看" })).toBeNull();

		renderPanel({ onOpenEntryInPlaza: vi.fn() });
		expect(screen.getAllByRole("button", { name: "在能力广场中查看" }).length).toBeGreaterThan(0);
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

	it("压缩屏障后的消息不提供立即发送，屏障前的消息仍可发送", () => {
		const onSendNow = vi.fn();
		render(
			<QueueCardView
				items={[
					{ id: "before", kind: "message", displayText: "屏障前", canSendNow: true },
					{ id: "compact", kind: "context_compaction", displayText: "压缩上下文", canSendNow: false },
					{ id: "after", kind: "message", displayText: "屏障后", canSendNow: false },
				]}
				labels={{ empty: "空", sendNow: "立即发送", delete: "删除", recall: "撤回到输入框", guide: "引导" }}
				onReorder={vi.fn()}
				onSendNow={onSendNow}
				onRemove={vi.fn()}
				onRecall={vi.fn()}
				onGuide={vi.fn()}
			/>,
		);

		expect(screen.getByText("屏障后").closest("button")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "屏障前" }));
		expect(onSendNow).toHaveBeenCalledWith("before");
	});
});
