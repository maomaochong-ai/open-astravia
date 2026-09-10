// @vitest-environment jsdom
/**
 * 外观设置页的「新会话页装饰」这块区域：装饰件与纹理收在同一块里，
 * 用户点纹理卡片能把选择交回模型，选中态跟着走。
 */
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppearanceSettingsModel } from "./useAppearanceSettingsModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { AppearanceSettingsView } = await import("./AppearanceSettingsView.js");

function model(
	overrides: Partial<Omit<AppearanceSettingsModel, "actions">> & {
		actions?: Partial<AppearanceSettingsModel["actions"]>;
	} = {},
): AppearanceSettingsModel {
	return {
		actions: Object.assign(
			{
				changeLanguage: vi.fn(),
				changeMode: vi.fn(),
				changeThemeName: vi.fn(),
				selectUiTheme: vi.fn(),
				setCursorStyle: vi.fn(),
				setOrnament: vi.fn(),
				setSidebarStyle: vi.fn(),
				setTexture: vi.fn(),
			},
			overrides.actions,
		),
		activeUiThemeId: "default",
		cursorOptions: [],
		cursorStyle: "default",
		labels: {
			languageHint: "languageHint",
			newSessionDecorHint: "newSessionDecorHint",
			newSessionDecorTitle: "新会话页装饰",
			ornamentHint: "ornamentHint",
			sections: {
				cursor: "鼠标指针",
				language: "语言",
				mode: "外观模式",
				ornament: "装饰件",
				sidebar: "侧边栏样式",
				texture: "纹理",
				theme: "主题颜色",
				uiTheme: "界面主题",
			},
			textureHint: "textureHint",
			title: "外观",
		},
		language: "system",
		languages: [],
		mode: "dark",
		modeOptions: [],
		narrow: true,
		ornamentId: "none",
		ornamentOptions: [{ active: true, hint: "ornamentNoneHint", id: "none", label: "无" }],
		showUiTheme: false,
		sidebarStyle: "classic",
		sidebarStyleOptions: [],
		textureId: "grid",
		textureOptions: [
			{ active: false, hint: "textureNoneHint", id: "none", label: "无" },
			{ active: true, hint: "textureGridHint", id: "grid", label: "网格" },
		],
		themeName: "default",
		themes: [],
		uiThemes: [],
		...overrides,
	};
}

describe("AppearanceSettingsView 的新会话页装饰区域", () => {
	it("装饰件与纹理紧跟在「新会话页装饰」这条标题之下，不与其它分区混排", () => {
		const view = render(<AppearanceSettingsView model={model()} />);

		// 断言的是分组关系本身（谁归在这条标题之下），不锁具体的盒子：
		// 这块区域是套卡片还是平铺属于视觉选择，改版不该把测试一起打红。
		const headings = Array.from(view.container.querySelectorAll("h2")).map((h) => h.textContent?.trim());
		const groupIndex = headings.indexOf("新会话页装饰");

		expect(groupIndex).toBeGreaterThanOrEqual(0);
		expect(headings.slice(groupIndex + 1, groupIndex + 3)).toEqual(["装饰件", "纹理"]);
		expect(view.getByText("newSessionDecorHint")).toBeTruthy();
	});

	it("点「无」把纹理选择交回模型", async () => {
		const setTexture = vi.fn();
		const view = render(<AppearanceSettingsView model={model({ actions: { setTexture } })} />);

		// 装饰件那组里也有一张「无」，按 hint 取这张才不会点错组。
		await userEvent.click(view.getByTitle("textureNoneHint"));

		expect(setTexture).toHaveBeenCalledWith("none");
	});

	it("当前铺着的那档带选中态，另一档没有", () => {
		const view = render(<AppearanceSettingsView model={model()} />);

		const grid = view.getByTitle("textureGridHint");
		const none = view.getByTitle("textureNoneHint");

		expect(grid.querySelector('[class*="mdi--check"]')).not.toBeNull();
		expect(none.querySelector('[class*="mdi--check"]')).toBeNull();
	});
});
