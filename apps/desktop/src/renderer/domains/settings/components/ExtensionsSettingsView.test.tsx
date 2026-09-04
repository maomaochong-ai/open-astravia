// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExtensionsSettingsView } from "./ExtensionsSettingsView";
import {
	toExtensionEntry,
	type ExtensionEntryModel,
	type ExtensionsSettingsModel,
} from "./useExtensionsSettingsModel";

const LABELS: ExtensionsSettingsModel["labels"] = {
	title: "扩展设置",
	description: "已安装插件提供的页面入口。",
	empty: "暂无插件页面",
	emptyHint: "启用插件后会出现在这里。",
	sectionTitle: "插件页面",
	count: "共 2 个",
};

function entry(overrides: Partial<ExtensionEntryModel> = {}): ExtensionEntryModel {
	return {
		key: "a",
		label: "Console",
		description: "",
		pluginName: "Browser",
		icon: "icon-[a]",
		open: () => undefined,
		...overrides,
	};
}

function view(overrides: Partial<Parameters<typeof toExtensionEntry>[0]> = {}) {
	return {
		pluginId: "demo",
		pluginName: "Demo Plugin",
		viewId: "console",
		label: "Console",
		...overrides,
	};
}

describe("toExtensionEntry", () => {
	it("resolves every plugin-authored string through the plugin catalog", () => {
		const catalog: Record<string, string> = {
			"%view.label%": "控制台",
			"%view.description%": "浏览器运行时状态与使用说明",
			// 插件名同样可能是占位符；不解析就会把 `%plugin.name%` 直接显示给用户。
			"%plugin.name%": "浏览器操作",
		};
		const mapped = toExtensionEntry(
			view({ label: "%view.label%", description: "%view.description%", pluginName: "%plugin.name%" }),
			(_pluginId, value) => catalog[value] ?? value,
			() => undefined,
		);

		expect(mapped.label).toBe("控制台");
		expect(mapped.description).toBe("浏览器运行时状态与使用说明");
		expect(mapped.pluginName).toBe("浏览器操作");
		expect(mapped.key).toBe("workspace:demo/console");
	});

	it("leaves the description empty and falls back to the default icon", () => {
		const mapped = toExtensionEntry(view(), (_pluginId, value) => value, () => undefined);

		expect(mapped.description).toBe("");
		expect(mapped.icon).toBe("icon-[solar--widget-2-linear]");
		expect(mapped.iconUrl).toBeUndefined();
	});

	it("keeps a full-color image icon when the view declares one", () => {
		const mapped = toExtensionEntry(
			view({ icon: "icon-[solar--bug-linear]", iconUrl: "vetta-plugin://demo/icon.png" }),
			(_pluginId, value) => value,
			() => undefined,
		);

		expect(mapped.iconUrl).toBe("vetta-plugin://demo/icon.png");
		expect(mapped.icon).toBe("icon-[solar--bug-linear]");
	});
});

describe("ExtensionsSettingsView", () => {
	it("renders one entry per registered workspace view and opens the clicked one", async () => {
		const openConsole = vi.fn();
		const openGallery = vi.fn();
		render(
			<ExtensionsSettingsView
				model={{
					labels: LABELS,
					entries: [
						entry({ open: openConsole }),
						entry({ key: "b", label: "Gallery", pluginName: "UI Design", open: openGallery }),
					],
				}}
			/>,
		);

		expect(screen.getAllByRole("button")).toHaveLength(2);
		await userEvent.click(screen.getByText("Gallery"));

		expect(openGallery).toHaveBeenCalledOnce();
		expect(openConsole).not.toHaveBeenCalled();
	});

	it("shows the empty state instead of a bare grid when no plugin contributes a page", () => {
		render(<ExtensionsSettingsView model={{ labels: LABELS, entries: [] }} />);

		expect(screen.getByText(LABELS.empty)).toBeTruthy();
		expect(screen.getByText(LABELS.emptyHint)).toBeTruthy();
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});

	it("clamps the description to two lines so long text cannot overflow onto neighbours", () => {
		const { container } = render(
			<ExtensionsSettingsView
				model={{
					labels: LABELS,
					entries: [entry({ description: "把本地 ComfyUI 工作流接成统一的视频生成 Provider。" })],
				}}
			/>,
		);

		const description = container.querySelector(".line-clamp-2");
		expect(description?.textContent).toBe("把本地 ComfyUI 工作流接成统一的视频生成 Provider。");
		// grid item 的 min-width:auto 会让长文案撑破卡片，卡片必须自己夹住溢出。
		expect(container.querySelector("button")?.className).toContain("min-w-0");
		expect(container.querySelector("button")?.className).toContain("overflow-hidden");
	});

	it("shows the plugin name in the description slot when the view has no description", () => {
		const { container } = render(
			<ExtensionsSettingsView model={{ labels: LABELS, entries: [entry({ pluginName: "Browser" })] }} />,
		);

		expect(container.querySelector(".line-clamp-2")?.textContent).toBe("Browser");
		// 描述位已经是插件名，底部不再重复一行归属。
		expect(screen.getAllByText("Browser")).toHaveLength(1);
	});

	it("adds an attribution row only when the description came from the view itself", () => {
		render(
			<ExtensionsSettingsView
				model={{
					labels: LABELS,
					entries: [entry({ description: "浏览器运行时状态与使用说明", pluginName: "Browser" })],
				}}
			/>,
		);

		expect(screen.getByText("浏览器运行时状态与使用说明")).toBeTruthy();
		expect(screen.getByText("Browser")).toBeTruthy();
	});

	it("renders an image icon as <img> and a class icon as a masked span", () => {
		const { container } = render(
			<ExtensionsSettingsView
				model={{
					labels: LABELS,
					entries: [entry(), entry({ key: "b", label: "Brand", iconUrl: "vetta-plugin://demo/icon.png" })],
				}}
			/>,
		);

		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(container.querySelector('img[src="vetta-plugin://demo/icon.png"]')).toBeTruthy();
		expect(container.querySelector("span.icon-\\[a\\]")).toBeTruthy();
	});
});
