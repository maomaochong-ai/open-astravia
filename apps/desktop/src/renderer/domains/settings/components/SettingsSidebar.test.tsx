// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsSidebarView } from "@vetta/theme-ui/settings";

const TABS = [
	{ key: "general", icon: "icon-[a]", label: "通用设置" },
	{
		key: "extensions",
		icon: "icon-[b]",
		label: "更多选项",
		children: [
			{ key: "workspace:browser/console", icon: "icon-[c]", label: "浏览器操作" },
			{ key: "workspace:vetta-ui-design/gallery", icon: "icon-[d]", label: "设计" },
		],
	},
];

function renderSidebar(overrides: Partial<Parameters<typeof SettingsSidebarView>[0]> = {}) {
	const onSelectTab = vi.fn();
	const onSelectChild = vi.fn();
	render(
		<SettingsSidebarView
			activeTab="general"
			betaBadgeLabel="BETA"
			narrow={false}
			onSelectTab={onSelectTab}
			onSelectChild={onSelectChild}
			expandLabel="展开插件页面"
			tabs={TABS}
			title="设置"
			{...overrides}
		/>,
	);
	return { onSelectTab, onSelectChild };
}

describe("SettingsSidebarView", () => {
	it("keeps the child list collapsed until the expander is clicked", async () => {
		renderSidebar();

		expect(screen.queryByText("浏览器操作")).toBeNull();
		await userEvent.click(screen.getByLabelText("展开插件页面"));

		expect(screen.getByText("浏览器操作")).toBeTruthy();
		expect(screen.getByLabelText("展开插件页面").getAttribute("aria-expanded")).toBe("true");
	});

	it("selects the tab itself when the row — not the expander — is clicked", async () => {
		const { onSelectTab, onSelectChild } = renderSidebar();

		await userEvent.click(screen.getByText("更多选项"));

		expect(onSelectTab).toHaveBeenCalledWith("extensions");
		expect(onSelectChild).not.toHaveBeenCalled();
		// 点行进页面，不应顺带展开清单。
		expect(screen.queryByText("浏览器操作")).toBeNull();
	});

	it("expands without navigating, then routes the clicked child through onSelectChild", async () => {
		const { onSelectTab, onSelectChild } = renderSidebar();

		await userEvent.click(screen.getByLabelText("展开插件页面"));
		expect(onSelectTab).not.toHaveBeenCalled();

		await userEvent.click(screen.getByText("设计"));
		expect(onSelectChild).toHaveBeenCalledWith("workspace:vetta-ui-design/gallery");
		expect(onSelectTab).not.toHaveBeenCalled();
	});

	it("collapses again on a second expander click", async () => {
		renderSidebar();
		const expander = screen.getByLabelText("展开插件页面");

		await userEvent.click(expander);
		await userEvent.click(expander);

		expect(screen.queryByText("浏览器操作")).toBeNull();
	});

	it("drops the expander in the narrow rail, where a child list has no room to read", () => {
		renderSidebar({ narrow: true });

		expect(screen.queryByLabelText("展开插件页面")).toBeNull();
		expect(screen.queryByText("浏览器操作")).toBeNull();
	});

	it("auto-expands and highlights the child that is currently open", () => {
		renderSidebar({ activeChildKey: "workspace:vetta-ui-design/gallery" });

		// 从列表页或深链进来时，用户要能立刻看出自己停在哪一层。
		expect(screen.getByText("设计")).toBeTruthy();
		expect(screen.getByText("设计").closest("button")?.getAttribute("aria-current")).toBe("page");
		expect(screen.getByText("浏览器操作").closest("button")?.getAttribute("aria-current")).toBeNull();
	});

	it("lets the user collapse an auto-expanded list again", async () => {
		renderSidebar({ activeChildKey: "workspace:vetta-ui-design/gallery" });

		await userEvent.click(screen.getByLabelText("展开插件页面"));

		expect(screen.queryByText("设计")).toBeNull();
	});

	it("renders a tab without children as a plain row", () => {
		renderSidebar();

		expect(screen.getByText("通用设置")).toBeTruthy();
		expect(screen.getAllByLabelText("展开插件页面")).toHaveLength(1);
	});
});
