import type { ThemePageDefinition } from "@vetta/theme-sdk";
import { describe, expect, it, vi } from "vitest";
import { createThemePagesModel } from "./theme-pages-model.js";

const ThemePage = (): null => null;

const pages: readonly ThemePageDefinition[] = [
	{
		id: "second",
		component: ThemePage,
		nav: { order: 2 },
		title: { "zh-CN": "第二页", "en-US": "Second" },
	},
	{
		id: "first",
		component: ThemePage,
		nav: { order: 1 },
		title: { "zh-CN": "第一页", "en-US": "First" },
	},
];

describe("createThemePagesModel", () => {
	it("keeps navigation presentation and delegates page ids to the theme capability facade", () => {
		const openedPageIds: string[] = [];
		const openPage = vi.fn((pageId: string) => openedPageIds.push(pageId));
		const model = createThemePagesModel(
			{ meta: { id: "theme.example" }, pages },
			"zh-CN",
			"/theme/theme.example/first",
			openPage,
		);

		expect(model.navItems).toEqual([
			{
				active: true,
				icon: undefined,
				key: "/theme/theme.example/first",
				label: "第一页",
				pageId: "first",
			},
			{
				active: false,
				icon: undefined,
				key: "/theme/theme.example/second",
				label: "第二页",
				pageId: "second",
			},
		]);

		model.actions.openPage("second");

		expect(openPage).toHaveBeenCalledExactlyOnceWith("second");
		expect(openedPageIds).toEqual(["second"]);
	});
});
