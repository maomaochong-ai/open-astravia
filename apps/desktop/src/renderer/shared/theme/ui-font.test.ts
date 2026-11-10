// @vitest-environment jsdom
/**
 * 字体偏好只有一个档位，一次写入同时落 `--font-sans` 与 `--font-mono`：
 * 界面、消息正文（`--font-content: var(--font-sans)`）、代码块、diff 与终端共用同一份字形。
 *
 * 几条关键约定：
 * - system 档必须把内联变量清掉，否则选回「系统默认」后上一次的字体栈会一直压在根节点上；
 * - 旧版本写下的 `--font-content` 内联值与独立的代码字体要在启动时清掉，否则会盖住全局设置；
 * - 上一版手填的「自定义字体栈」已经下线，存档里的 `custom` 与残留键都必须在启动时被清掉。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyFont,
	applyStoredFont,
	DEFAULT_FONT,
	FONT_STORAGE_KEY,
	fontStack,
	getStoredFont,
	isUiFontFamily,
	setStoredFont,
	watchStoredFont,
} from "./ui-font";

describe("全局字体偏好", () => {
	beforeEach(() => {
		localStorage.clear();
		const root = document.documentElement;
		for (const attr of ["data-font", "data-ui-font", "data-code-font", "data-content-font"]) {
			root.removeAttribute(attr);
		}
		for (const token of ["--font-sans", "--font-mono", "--font-content"]) {
			root.style.removeProperty(token);
		}
	});

	afterEach(() => {
		localStorage.clear();
	});

	it("没有存过时用系统默认", () => {
		expect(getStoredFont()).toBe(DEFAULT_FONT);
		expect(DEFAULT_FONT).toBe("system");
	});

	it("存过的值在下次启动时被应用，界面与代码两侧同时落到同一个字体栈", () => {
		localStorage.setItem(FONT_STORAGE_KEY, "serif");

		applyStoredFont();

		const stack = fontStack("serif") as string;
		expect(document.documentElement.dataset.font).toBe("serif");
		expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(stack);
		expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(stack);
	});

	it("选回系统默认会清掉两侧内联字体栈，把令牌交还给样式表", () => {
		applyFont("mono-code");
		expect(document.documentElement.style.getPropertyValue("--font-mono")).not.toBe("");

		applyFont("system");

		expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("");
		expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe("");
		expect(document.documentElement.dataset.font).toBe("system");
		expect(fontStack("system")).toBeNull();
	});

	it("存了无法识别的值时回落系统默认，不会写坏根节点", () => {
		localStorage.setItem(FONT_STORAGE_KEY, "comic-sans");

		applyStoredFont();

		expect(getStoredFont()).toBe("system");
		expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("");
	});

	it("每一档都有可用的字体栈，结尾是通用族，且中英文都给了回退", () => {
		const families = [
			"sans",
			"humanist",
			"geometric",
			"rounded",
			"serif",
			"reading",
			"song",
			"kai",
			"hei",
			"mono",
			"mono-code",
		] as const;
		for (const family of families) {
			expect(isUiFontFamily(family)).toBe(true);
			expect(fontStack(family)).toMatch(/sans-serif|serif|monospace$/);
		}
		for (const family of ["song", "kai", "serif", "reading"] as const) {
			expect(fontStack(family)).toContain("Songti SC");
		}
		for (const family of ["sans", "humanist", "geometric", "rounded", "hei"] as const) {
			expect(fontStack(family)).toContain("PingFang SC");
		}
	});

	it("旧版本残留的消息字体覆盖值与独立代码字体在启动时被清掉", () => {
		localStorage.setItem("astravia-content-font", "song");
		localStorage.setItem("astravia-code-font", "mono");
		localStorage.setItem("astravia-ui-font", "kai");
		document.documentElement.style.setProperty("--font-content", "Songti SC, serif");
		document.documentElement.dataset.contentFont = "song";

		applyStoredFont();

		expect(document.documentElement.style.getPropertyValue("--font-content")).toBe("");
		expect(document.documentElement.dataset.contentFont).toBeUndefined();
		expect(localStorage.getItem("astravia-content-font")).toBeNull();
		// 上一版的界面字体成为唯一档位，并被写进新键。
		expect(document.documentElement.dataset.font).toBe("kai");
		expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe("kai");
		expect(localStorage.getItem("astravia-ui-font")).toBeNull();
		expect(localStorage.getItem("astravia-code-font")).toBeNull();
	});

	it("上一版停在自定义字体栈的存档回落为系统默认，残留栈键被清掉", () => {
		localStorage.setItem(FONT_STORAGE_KEY, "custom");
		localStorage.setItem("astravia-custom-font", '"Fira Code", monospace');

		applyStoredFont();

		expect(getStoredFont()).toBe("system");
		expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe("system");
		expect(localStorage.getItem("astravia-custom-font")).toBeNull();
		expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("");
		expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe("");
	});

	it("setStoredFont 会清掉上一版的旧键", () => {
		localStorage.setItem("astravia-ui-font", "serif");
		localStorage.setItem("astravia-code-font", "mono");

		setStoredFont("reading");

		expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe("reading");
		expect(localStorage.getItem("astravia-ui-font")).toBeNull();
		expect(localStorage.getItem("astravia-code-font")).toBeNull();
	});

	/*
	 * 快捷面板、吉祥物、引导向导各是独立窗口：主窗口改字体只写了自己的根节点，
	 * 其他窗口必须靠同源 `storage` 事件跟上，否则同一个产品里会同时存在两种字体。
	 */
	it("其他窗口收到字体存档变更后立即跟上，与本窗口的选择保持一致", () => {
		localStorage.setItem(FONT_STORAGE_KEY, "song");
		const stop = watchStoredFont();

		window.dispatchEvent(new StorageEvent("storage", { key: FONT_STORAGE_KEY, newValue: "song" }));

		const stack = fontStack("song") as string;
		expect(document.documentElement.dataset.font).toBe("song");
		expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(stack);
		expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(stack);
		stop();
	});

	it("只跟随字体键，主题等其他存档变化不会动字体", () => {
		applyFont("kai");
		const stop = watchStoredFont();

		window.dispatchEvent(new StorageEvent("storage", { key: "astravia-theme", newValue: "midnight" }));

		expect(document.documentElement.dataset.font).toBe("kai");
		stop();
	});
});
