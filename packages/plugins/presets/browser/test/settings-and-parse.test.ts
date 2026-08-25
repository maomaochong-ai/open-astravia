import { describe, expect, it } from "vitest";
import { normalizeBrowserSettings, normalizeToolsProfile, parseAllowedDomains } from "../src/config/settings";
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

describe("normalizeToolsProfile", () => {
	it("保留合法的逗号组合并去重", () => {
		expect(normalizeToolsProfile("core, network ,core")).toBe("core,network");
	});

	it("非法 profile 会让 agent-browser 起不来，所以整体回落 core", () => {
		expect(normalizeToolsProfile("nonsense")).toBe("core");
		expect(normalizeToolsProfile("")).toBe("core");
		expect(normalizeToolsProfile(42)).toBe("core");
	});

	it("大小写与空白不敏感", () => {
		expect(normalizeToolsProfile(" ALL ")).toBe("all");
	});
});

describe("parseAllowedDomains", () => {
	it("逗号、分号、换行、空格都能分隔", () => {
		expect(parseAllowedDomains("a.com, b.com;c.com\n d.com")).toEqual(["a.com", "b.com", "c.com", "d.com"]);
	});

	it("去重并统一小写", () => {
		expect(parseAllowedDomains("A.com,a.COM")).toEqual(["a.com"]);
	});

	it("空白输入表示不限制", () => {
		expect(parseAllowedDomains("   \n ")).toEqual([]);
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
