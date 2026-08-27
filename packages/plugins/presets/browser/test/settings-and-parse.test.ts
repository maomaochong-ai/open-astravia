import { describe, expect, it } from "vitest";
import { normalizeBrowserSettings, parseAllowedHosts } from "../src/config/settings";

describe("normalizeBrowserSettings", () => {
	it("空设置回落到托管、可见浏览器和有限输出", () => {
		expect(normalizeBrowserSettings({})).toEqual({
			browserSource: "managed",
			headed: true,
			allowedDomains: "",
			maxOutput: 20_000,
		});
	});

	it("未知 browserSource 不会误开附着模式", () => {
		expect(normalizeBrowserSettings({ browserSource: "cdp" }).browserSource).toBe("managed");
	});

	it("收窄数字设置并限制极端值", () => {
		expect(normalizeBrowserSettings({ maxOutput: "40000" }).maxOutput).toBe(40_000);
		expect(normalizeBrowserSettings({ maxOutput: 10 }).maxOutput).toBe(2_000);
		expect(normalizeBrowserSettings({ maxOutput: 9_000_000 }).maxOutput).toBe(500_000);
	});
});

describe("parseAllowedHosts", () => {
	it("空设置使用 manifest 的通配授权", () => {
		expect(parseAllowedHosts("  ")).toEqual(["*"]);
	});

	it("按逗号和换行解析、归一化并去重", () => {
		expect(parseAllowedHosts("Example.com, *.EXAMPLE.org\nexample.com")).toEqual([
			"example.com",
			"*.example.org",
		]);
	});
});
