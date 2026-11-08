// @vitest-environment jsdom
/**
 * 字体偏好：只换 `--font-sans`（界面，全局）与 `--font-mono`（代码）两个令牌。
 * 消息正文不再有独立档位，靠样式表的 `--font-content: var(--font-sans)` 跟随界面字体。
 *
 * 两条关键约定：
 * - system 档必须把内联变量清掉，否则选回「系统默认」后上一次的字体栈会一直压在根节点上；
 * - 旧版本写下的 `--font-content` 内联值要在启动时清掉，否则它会盖住「跟随界面字体」。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyCodeFont,
	applyStoredUiFont,
	applyUiFont,
	DEFAULT_CODE_FONT,
	DEFAULT_UI_FONT,
	getStoredCodeFont,
	getStoredUiFont,
	UI_FONT_STORAGE_KEY,
	uiFontStack,
} from "./ui-font";

describe("界面字体偏好", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute("data-ui-font");
		document.documentElement.removeAttribute("data-content-font");
		document.documentElement.style.removeProperty("--font-sans");
		document.documentElement.style.removeProperty("--font-content");
		document.documentElement.style.removeProperty("--font-mono");
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

	it("每一档都识别，未知值回落到系统默认", () => {
		expect(getStoredCodeFont()).toBe(DEFAULT_CODE_FONT);
		for (const family of ["rounded", "sans", "serif", "song", "kai", "mono"] as const) {
			expect(uiFontStack(family)).toMatch(/sans-serif|serif|monospace$/);
		}
	});

	it("旧版本残留的消息字体覆盖值会在启动时被清掉，回到跟随界面字体", () => {
		localStorage.setItem("astravia-content-font", "song");
		document.documentElement.style.setProperty("--font-content", "Songti SC, serif");
		document.documentElement.dataset.contentFont = "song";

		applyStoredUiFont();

		expect(document.documentElement.style.getPropertyValue("--font-content")).toBe("");
		expect(document.documentElement.dataset.contentFont).toBeUndefined();
		expect(localStorage.getItem("astravia-content-font")).toBeNull();
	});

	it("代码字体落到 --font-mono 上，与界面字体互不影响", () => {
		applyUiFont("serif");
		applyCodeFont("mono");

		expect(document.documentElement.style.getPropertyValue("--font-mono")).toContain("SF Mono");
		expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain("Songti SC");

		applyCodeFont("system");
		expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe("");
	});
});
