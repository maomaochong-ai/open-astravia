// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsSidebarView } from "@astravia-org/theme-ui/settings";

const TABS = [
	{ key: "general", icon: "icon-[solar--settings-linear]", label: "通用设置" },
	{
		key: "extensions",
		icon: "icon-[solar--widget-linear]",
		label: "更多选项",
		children: [
			{ key: "workspace:browser/console", icon: "icon-[solar--globus-linear]", label: "浏览器操作" },
			{ key: "workspace:astravia-ui-design/gallery", icon: "icon-[solar--palette-linear]", label: "设计" },
		],
	},
];

type SidebarOverrides = Partial<Parameters<typeof SettingsSidebarView>[0]>;

function renderSidebar(overrides: SidebarOverrides = {}) {
	const onSelectTab = vi.fn();
	const onSelectChild = vi.fn();
	const view = (extra: SidebarOverrides) => (
		<SettingsSidebarView
			activeTab="general"
			betaBadgeLabel="BETA"
			narrow={false}
			onSelectTab={onSelectTab}
			onSelectChild={onSelectChild}
			tabs={TABS}
			title="设置"
			{...overrides}
			{...extra}
		/>
	);
	const rendered = render(view({}));
	return {
		onSelectTab,
		onSelectChild,
		rerender: (extra: SidebarOverrides) => rendered.rerender(view(extra)),
	};
}

describe("SettingsSidebarView", () => {
	it("悬停或聚焦标签只预取代码，点击仍选择该标签", () => {
		const onTabIntent = vi.fn();
		const { onSelectTab } = renderSidebar({ onTabIntent });
		const settings = screen.getByRole("button", { name: "通用设置" });
		fireEvent.mouseEnter(settings);
		fireEvent.focus(settings);
		expect(onTabIntent).toHaveBeenCalledWith("general");
		expect(onSelectTab).not.toHaveBeenCalled();
		fireEvent.click(settings);
		expect(onSelectTab).toHaveBeenCalledWith("general");
	});

	it("选中该标签时清单跟着展开，点行即导航", async () => {
		const { onSelectTab, onSelectChild } = renderSidebar();

		expect(screen.queryByText("浏览器操作")).toBeNull();
		await userEvent.click(screen.getByText("更多选项"));

		expect(onSelectTab).toHaveBeenCalledWith("extensions");
		expect(onSelectChild).not.toHaveBeenCalled();
	});

	it("展开态跟随选中态：选中即展开，切走即收起", () => {
		const { rerender } = renderSidebar({ activeTab: "extensions" });
		expect(screen.getByText("浏览器操作")).toBeTruthy();
		expect(screen.getByText("更多选项").closest("button")?.getAttribute("aria-expanded")).toBe("true");

		rerender({ activeTab: "general" });
		expect(screen.queryByText("浏览器操作")).toBeNull();
	});

	it("下级入口走 onSelectChild，不重复切标签", async () => {
		const { onSelectTab, onSelectChild } = renderSidebar({ activeTab: "extensions" });

		await userEvent.click(screen.getByText("设计"));

		expect(onSelectChild).toHaveBeenCalledWith("workspace:astravia-ui-design/gallery");
		expect(onSelectTab).not.toHaveBeenCalled();
	});

	it("窄侧栏不展开清单，文字读不出来", () => {
		renderSidebar({ activeTab: "extensions", narrow: true });

		expect(screen.queryByText("浏览器操作")).toBeNull();
	});

	it("深链停在某个下级入口时自动展开并高亮它", () => {
		renderSidebar({ activeChildKey: "workspace:astravia-ui-design/gallery" });

		// 从列表页或深链进来时，用户要能立刻看出自己停在哪一层。
		expect(screen.getByText("设计")).toBeTruthy();
		expect(screen.getByText("设计").closest("button")?.getAttribute("aria-current")).toBe("page");
		expect(screen.getByText("浏览器操作").closest("button")?.getAttribute("aria-current")).toBeNull();
	});

	it("没有下级入口的标签只是一行普通入口", async () => {
		const { onSelectTab } = renderSidebar();

		await userEvent.click(screen.getByText("通用设置"));

		expect(onSelectTab).toHaveBeenCalledWith("general");
		expect(screen.getByText("通用设置").closest("button")?.getAttribute("aria-expanded")).toBeNull();
	});

	it("标签超出视口时导航区可滚动、隐藏滚动条，并只在有内容的一侧渐隐", () => {
		const { container } = render(
			<SettingsSidebarView
				activeTab="general"
				betaBadgeLabel="BETA"
				narrow={false}
				onSelectTab={vi.fn()}
				tabs={TABS}
				title="设置"
			/>,
		);
		const nav = container.querySelector("nav") as HTMLElement;
		expect(nav.className).toContain("no-scrollbar");
		expect(nav.className).toContain("overflow-y-auto");
		// 内容未超出时不挂 mask，避免无端淡掉首尾行
		expect(nav.style.maskImage).toBeFalsy();

		const metrics = { scrollHeight: 600, clientHeight: 200, scrollTop: 0 };
		for (const [key, value] of Object.entries(metrics)) {
			Object.defineProperty(nav, key, { configurable: true, writable: true, value });
		}
		fireEvent.scroll(nav);
		// 在顶部：只有底部渐隐
		expect(nav.style.maskImage).toContain("black, black");
		expect(nav.style.maskImage).toContain("transparent)");

		(nav as unknown as { scrollTop: number }).scrollTop = 100;
		fireEvent.scroll(nav);
		expect(nav.style.maskImage).toMatch(/^linear-gradient\(to bottom, transparent, black/);
		expect(nav.style.maskImage).toContain("calc(100% - 24px), transparent)");

		(nav as unknown as { scrollTop: number }).scrollTop = 400;
		fireEvent.scroll(nav);
		// 到底：只有顶部渐隐
		expect(nav.style.maskImage).toMatch(/black, black\)$/);
	});
});
