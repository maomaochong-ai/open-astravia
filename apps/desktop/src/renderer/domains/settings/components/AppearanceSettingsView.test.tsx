// @vitest-environment jsdom
/**
 * 外观设置页的「新会话页装饰」这块区域：装饰件与纹理收在同一块里，
 * 用户点纹理卡片能把选择交回模型，选中态跟着走。
 */
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppearanceSettingsModel } from "./useAppearanceSettingsModel";

const { renderMarioPreview } = vi.hoisted(() => ({ renderMarioPreview: vi.fn() }));

vi.mock("@shared/components/mario/PixelMarioBlocks", () => ({
	PixelMarioBlocks: () => {
		renderMarioPreview();
		return <div data-testid="mario-preview" />;
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

// 字体改了用下拉收纳：把 MotionSelect 换成原生 select，就能用真实的选择路径去驱动它。
vi.mock("@astravia-org/theme-ui/settings", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@astravia-org/theme-ui/settings")>();
	return {
		...actual,
		MotionSelect: ({
			value,
			onValueChange,
			options,
			"aria-label": ariaLabel,
		}: {
			value: string;
			onValueChange: (next: string) => void;
			options: readonly { value: string; label: React.ReactNode }[];
			"aria-label"?: string;
		}) => (
			<select aria-label={ariaLabel} value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{typeof option.label === "string" ? option.label : option.value}
					</option>
				))}
			</select>
		),
	};
});

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
				setUiFont: vi.fn(),
				setCodeFont: vi.fn(),
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
				font: "字体",
				ornament: "装饰件",
				sidebar: "侧边栏样式",
				texture: "纹理",
				theme: "主题颜色",
				uiTheme: "界面主题",
			},
			textureHint: "textureHint",
			title: "外观",
			uiFontHint: "uiFontHint",
			codeFontHint: "codeFontHint",
			fontRoles: { ui: "全局字体", code: "代码字体" },
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
		uiFont: "system",
		uiFontOptions: [
			{ active: true, hint: "uiFontSystemHint", id: "system", label: "系统默认" },
			{ active: false, hint: "uiFontSerifHint", id: "serif", label: "衷线" },
		],
		codeFont: "mono",
		codeFontOptions: [
			{ active: false, hint: "uiFontSystemHint", id: "system", label: "系统默认" },
			{ active: true, hint: "uiFontMonoHint", id: "mono", label: "等宽" },
		],
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

	it("切换外观模式时不会重新渲染无关的装饰预览", () => {
		const initial = model({
			ornamentId: "mario",
			ornamentOptions: [{ active: true, hint: "marioHint", id: "mario", label: "马里奥" }],
		});
		renderMarioPreview.mockClear();
		const view = render(<AppearanceSettingsView model={initial} />);
		expect(renderMarioPreview).toHaveBeenCalledTimes(1);

		view.rerender(<AppearanceSettingsView model={{ ...initial, mode: "light" }} />);

		expect(renderMarioPreview).toHaveBeenCalledTimes(1);
	});
});

describe("AppearanceSettingsView 的字体区域", () => {
	it("全局字体与代码字体各是一个下拉，改哪行就把选择交回哪一项", async () => {
		const setUiFont = vi.fn();
		const setCodeFont = vi.fn();
		const view = render(<AppearanceSettingsView model={model({ actions: { setUiFont, setCodeFont } })} />);

		const ui = view.container.querySelector('[data-font-role="ui"]') as HTMLElement;
		const code = view.container.querySelector('[data-font-role="code"]') as HTMLElement;

		// 字体区只剩两行：全局（含消息正文）与代码；消息正文不再单独占一行。
		expect(view.container.querySelector('[data-font-role="content"]')).toBeNull();

		// 下拉的回显值跟着模型，不跟着点击变化。
		expect((within(ui).getByRole("combobox") as HTMLSelectElement).value).toBe("system");
		await userEvent.selectOptions(within(ui).getByRole("combobox"), "serif");
		expect(setUiFont).toHaveBeenCalledWith("serif");
		expect(setCodeFont).not.toHaveBeenCalled();

		expect((within(code).getByRole("combobox") as HTMLSelectElement).value).toBe("mono");
		await userEvent.selectOptions(within(code).getByRole("combobox"), "system");
		expect(setCodeFont).toHaveBeenCalledWith("system");
		expect(setUiFont).toHaveBeenCalledTimes(1);
	});
});
