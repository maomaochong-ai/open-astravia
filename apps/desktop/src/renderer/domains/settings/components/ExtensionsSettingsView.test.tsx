// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExtensionsSettingsView } from "./ExtensionsSettingsView";
import { toExtensionEntry, type ExtensionsSettingsModel } from "./useExtensionsSettingsModel";

const LABELS: ExtensionsSettingsModel["labels"] = {
	title: "扩展设置",
	description: "已安装插件提供的页面入口。",
	empty: "暂无插件页面",
	emptyHint: "启用插件后会出现在这里。",
};

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
	it("resolves plugin catalog text and prefers the view description as the subtitle", () => {
		const entry = toExtensionEntry(
			view({ label: "%view.label%", description: "%view.description%" }),
			(_pluginId, value) => (value === "%view.label%" ? "控制台" : "浏览器自动化"),
			() => undefined,
		);

		expect(entry.label).toBe("控制台");
		expect(entry.subtitle).toBe("浏览器自动化");
		expect(entry.key).toBe("workspace:demo/console");
	});

	it("falls back to the plugin name and the default icon", () => {
		const entry = toExtensionEntry(view(), (_pluginId, value) => value, () => undefined);

		expect(entry.subtitle).toBe("Demo Plugin");
		expect(entry.icon).toBe("icon-[solar--widget-2-linear]");
		expect(entry.iconUrl).toBeUndefined();
	});

	it("keeps a full-color image icon when the view declares one", () => {
		const entry = toExtensionEntry(
			view({ icon: "icon-[solar--bug-linear]", iconUrl: "vetta-plugin://demo/icon.png" }),
			(_pluginId, value) => value,
			() => undefined,
		);

		expect(entry.iconUrl).toBe("vetta-plugin://demo/icon.png");
		expect(entry.icon).toBe("icon-[solar--bug-linear]");
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
						{ key: "a", label: "Console", subtitle: "Browser", icon: "icon-[a]", open: openConsole },
						{ key: "b", label: "Gallery", subtitle: "UI Design", icon: "icon-[b]", open: openGallery },
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

	it("renders an image icon as <img> and a class icon as a masked span", () => {
		const { container } = render(
			<ExtensionsSettingsView
				model={{
					labels: LABELS,
					entries: [
						{ key: "a", label: "Console", subtitle: "Browser", icon: "icon-[a]", open: () => undefined },
						{
							key: "b",
							label: "Brand",
							subtitle: "Colored",
							icon: "icon-[b]",
							iconUrl: "vetta-plugin://demo/icon.png",
							open: () => undefined,
						},
					],
				}}
			/>,
		);

		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(container.querySelector('img[src="vetta-plugin://demo/icon.png"]')).toBeTruthy();
		expect(container.querySelector("span.icon-\\[a\\]")).toBeTruthy();
	});
});
