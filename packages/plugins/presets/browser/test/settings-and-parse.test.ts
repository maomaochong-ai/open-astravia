import { describe, expect, it } from "vitest";
import { normalizeBrowserSettings } from "../src/config/settings";
import { detectSystemChrome } from "../src/runtime/parse";

describe("normalizeBrowserSettings", () => {
	it("空设置回落到保守默认", () => {
		expect(normalizeBrowserSettings({})).toMatchObject({
			browserSource: "managed",
			denyEval: true,
			denyUpload: true,
			denyDownload: false,
		});
	});

	it("未知的 browserSource 一律按托管处理，不会误开附着模式", () => {
		expect(normalizeBrowserSettings({ browserSource: "cdp" }).browserSource).toBe("managed");
	});

	it("设置页的数字输入可能是字符串", () => {
		expect(normalizeBrowserSettings({ maxOutput: "40000" }).maxOutput).toBe(40000);
	});
});

describe("detectSystemChrome", () => {
	it("识别出已有系统 Chrome", () => {
		expect(detectSystemChrome("  ✓ System Chrome found: /Applications/Google Chrome.app")).toBe(true);
	});

	it("识别出没有 Chrome", () => {
		expect(detectSystemChrome("⚠ No Chrome installation detected.")).toBe(false);
	});

	it("上游文案变了就返回 null，不猜 —— 猜错的代价是白下几百 MB 或该下没下", () => {
		expect(detectSystemChrome("added 1 package in 3s")).toBeNull();
	});
});
