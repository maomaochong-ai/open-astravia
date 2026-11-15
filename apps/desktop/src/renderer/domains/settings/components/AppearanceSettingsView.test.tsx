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
				setOrnament: vi.fn(),
				setTexture: vi.fn(),
				setAppIcon: vi.fn(),
				setFont: vi.fn(),
				setUiZoom: vi.fn(),
				resetUiZoom: vi.fn(),
			},
			overrides.actions,
		),
		activeUiThemeId: "default",
		labels: {
			newSessionDecorHint: "newSessionDecorHint",
			newSessionDecorTitle: "新会话页装饰",
			ornamentHint: "ornamentHint",
			sections: {
				appIcon: "应用图标",
				language: "语言",
				mode: "外观模式",
				font: "字体",
				ornament: "装饰件",
				texture: "纹理",
				theme: "主题颜色",
				uiTheme: "界面主题",
				uiZoom: "界面大小",
			},
			textureHint: "textureHint",
			title: "外观",
			uiZoomSliderLabel: "界面大小",
			uiZoomReset: "恢复默认大小",
		},
		language: "system",
		languages: [],
		mode: "dark",
		modeOptions: [],
		narrow: true,
		appIconOptions: [{ active: true, id: "default", label: "默认", preview: "default.png" }],
		ornamentId: "none",
		ornamentOptions: [{ active: true, hint: "ornamentNoneHint", id: "none", label: "无" }],
		showUiTheme: false,
		textureId: "grid",
		textureOptions: [
			{ active: false, hint: "textureNoneHint", id: "none", label: "无" },
			{ active: true, hint: "textureGridHint", id: "grid", label: "网格" },
		],
		themeName: "default",
		themes: [],
		uiThemes: [],
		uiZoom: { factor: 1, stepIndex: 2, steps: [0.75, 0.9, 1, 1.1, 1.25, 1.5], default: 1 },
		font: "system",
		fontOptions: [
			{ active: true, hint: "uiFontSystemHint", id: "system", label: "系统默认" },
			{ active: false, hint: "uiFontSerifHint", id: "serif", label: "衷线" },
		],
		...overrides,
	};
}

describe("AppearanceSettingsView 的新会话页装饰区域", () => {
	// 整页渲染要挂载主题、字体与装饰预览；CI 上并发跑时 5s 默认值会偶发不够。
	const RENDER_TIMEOUT = 20_000;

	it("装饰件与纹理收在同一张卡片的两行里，不与其它分区混排", () => {
		const view = render(<AppearanceSettingsView model={model()} />);

		// 断言分组关系本身（谁归在这条标题之下），不锁具体的盒子。
		expect(view.getByRole("heading", { name: "新会话页装饰" })).toBeTruthy();
		expect(view.getByText("newSessionDecorHint")).toBeTruthy();
		expect(view.getByRole("button", { name: "装饰件" })).toBeTruthy();
		expect(view.getByRole("button", { name: "纹理" })).toBeTruthy();
		// 选项列表收在 popover 里，默认不占版面。
		expect(view.queryByTitle("textureGridHint")).toBeNull();
	}, RENDER_TIMEOUT);

	it("点「无」把纹理选择交回模型", async () => {
		const setTexture = vi.fn();
		const view = render(<AppearanceSettingsView model={model({ actions: { setTexture } })} />);

		await userEvent.click(view.getByRole("button", { name: "纹理" }));
		// 装饰件那组里也有一个「无」，打开纹理的 popover 后只会有纹理那几个卡片。
		await userEvent.click(view.getByTitle("textureNoneHint"));

		expect(setTexture).toHaveBeenCalledWith("none");
	}, RENDER_TIMEOUT);

	it("当前铺着的那档带选中态，另一档没有", async () => {
		const view = render(<AppearanceSettingsView model={model()} />);

		await userEvent.click(view.getByRole("button", { name: "纹理" }));
		const grid = view.getByTitle("textureGridHint");
		const none = view.getByTitle("textureNoneHint");

		expect(grid.querySelector('[class*="mdi--check"]')).not.toBeNull();
		expect(none.querySelector('[class*="mdi--check"]')).toBeNull();
	}, RENDER_TIMEOUT);

	it("切换外观模式时不会重新渲染无关的装饰预览", async () => {
		const initial = model({
			ornamentId: "mario",
			ornamentOptions: [{ active: true, hint: "marioHint", id: "mario", label: "马里奥" }],
		});
		renderMarioPreview.mockClear();
		const view = render(<AppearanceSettingsView model={initial} />);

		await userEvent.click(view.getByRole("button", { name: "装饰件" }));
		expect(renderMarioPreview).toHaveBeenCalledTimes(1);

		view.rerender(<AppearanceSettingsView model={{ ...initial, mode: "light" }} />);

		expect(renderMarioPreview).toHaveBeenCalledTimes(1);
	}, RENDER_TIMEOUT);
});

describe("AppearanceSettingsView 的字体区域", () => {
	it("字体只占一行，选定后界面与代码一起换", async () => {
		const setFont = vi.fn();
		const view = render(<AppearanceSettingsView model={model({ actions: { setFont } })} />);

		const global = view.container.querySelector('[data-font-role="global"]') as HTMLElement;
		expect(global).not.toBeNull();
		// 字体与语言 / 外观模式 / 界面大小 / 应用图标同处一张圆角卡片，且是最后一行（不再自带标题与说明）。
		const card = global.closest("[data-setting-section-highlight-target]");
		expect(card?.getAttribute("data-setting-section-highlight-target")).toBe("appearance-language");
		expect(card?.querySelector('[data-setting-section-id="appearance-app-icon"]')).not.toBeNull();
		expect(view.queryByRole("heading", { name: "字体" })).toBeNull();
		// 旧的「界面 / 代码 / 消息正文」三行都不该再出现。
		for (const role of ["ui", "code", "content"]) {
			expect(view.container.querySelector(`[data-font-role="${role}"]`)).toBeNull();
		}

		expect((within(global).getByRole("combobox") as HTMLSelectElement).value).toBe("system");
		await userEvent.selectOptions(within(global).getByRole("combobox"), "serif");
		expect(setFont).toHaveBeenCalledWith("serif");
	}, 20_000);
});
