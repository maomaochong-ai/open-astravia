// @vitest-environment jsdom
/**
 * 界面字体偏好：只换 `--font-sans` 这一个令牌。
 * 关键约定是 system 档必须把内联变量清掉，否则用户选回「系统默认」后
 * 上一次选中的字体栈会一直留在根节点上，styles.css 的默认值再也没机会生效。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyStoredUiFont,
	applyUiFont,
	DEFAULT_UI_FONT,
	getStoredUiFont,
	UI_FONT_STORAGE_KEY,
	uiFontStack,
} from "./ui-font";

describe("界面字体偏好", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute("data-ui-font");
		document.documentElement.style.removeProperty("--font-sans");
	});

	afterEach(() => {
		localStorage.clear();
	});

	it("没有存过时用系统默认", () => {
		expect(getStoredUiFont()).toBe(DEFAULT_UI_FONT);
		expect(DEFAULT_UI_FONT).toBe("system");
	});

	it("存过的值在下次启动时被应用，并落到 --font-sans 上", () => {
		localStorage.setItem(UI_FONT_STORAGE_KEY, "serif");

		applyStoredUiFont();

		expect(document.documentElement.dataset.uiFont).toBe("serif");
		expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(uiFontStack("serif") as string);
	});

	it("选回系统默认会清掉内联字体栈，把令牌交还给样式表", () => {
		applyUiFont("mono");
		expect(document.documentElement.style.getPropertyValue("--font-sans")).not.toBe("");

		applyUiFont("system");

		expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("");
		expect(document.documentElement.dataset.uiFont).toBe("system");
		expect(uiFontStack("system")).toBeNull();
	});

	it("存了无法识别的值时回落系统默认，不会写坏根节点", () => {
		localStorage.setItem(UI_FONT_STORAGE_KEY, "comic-sans");

		applyStoredUiFont();

		expect(getStoredUiFont()).toBe("system");
		expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("");
	});

	it("每一档都有可用的字体栈，且中英文都给了回退", () => {
		for (const family of ["rounded", "serif", "mono"] as const) {
			const stack = uiFontStack(family);
			expect(stack).toBeTruthy();
			expect(stack).toMatch(/sans-serif|serif|monospace$/);
		}
		expect(uiFontStack("serif")).toContain("Songti SC");
		for (const family of ["rounded", "mono"] as const) {
			expect(uiFontStack(family)).toContain("PingFang SC");
		}
	});
});
