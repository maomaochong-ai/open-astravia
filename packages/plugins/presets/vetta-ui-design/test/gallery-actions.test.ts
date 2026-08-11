import { describe, expect, it } from "vitest";
import { isSharePackageName, projectNameFromShareFile, toProjectName } from "../src/gallery/gallery-actions";
import { parseAccentColor } from "../src/gallery/theme-accent";
import { formatRelativeTime } from "../src/gallery/relative-time";

describe("toProjectName", () => {
	it("剥掉路径分隔符与空白——宿主的 ProjectService 会拒绝带分隔符的名字", () => {
		expect(toProjectName(" my design ")).toBe("my-design");
		expect(toProjectName("a/b\\c")).toBe("a-b-c");
	});

	it("清洗后为空时给出兜底名，不产生空目录名", () => {
		expect(toProjectName("///")).toBe("design");
	});
});

describe("projectNameFromShareFile", () => {
	it("去掉扩展名与导出时加的 -share 后缀", () => {
		expect(projectNameFromShareFile("checkout-share.vetdz")).toBe("checkout");
		expect(projectNameFromShareFile("checkout.vetd")).toBe("checkout");
	});
});

describe("isSharePackageName", () => {
	it("认新扩展名与历史导出的 .vetd zip，大小写不敏感", () => {
		expect(isSharePackageName("a.vetdz")).toBe(true);
		expect(isSharePackageName("a.VETD")).toBe(true);
		expect(isSharePackageName("a.zip")).toBe(false);
	});
});

describe("parseAccentColor", () => {
	it("取 theme.css 里的 --color-primary", () => {
		expect(parseAccentColor("@theme {\n\t--color-primary: #4f46e5;\n}")).toBe("#4f46e5");
	});

	it("间接引用与缺失都返回 null，由卡片退回中性色", () => {
		expect(parseAccentColor("--color-primary: var(--brand);")).toBeNull();
		expect(parseAccentColor("--color-accent: #fff;")).toBeNull();
	});
});

describe("formatRelativeTime", () => {
	const now = Date.parse("2026-08-11T12:00:00Z");

	it("一分钟以内不报数字，交给调用方用「刚刚」", () => {
		expect(formatRelativeTime(now - 30_000, "zh", now)).toBeNull();
	});

	it("按最大的合适单位换算", () => {
		expect(formatRelativeTime(now - 3 * 24 * 60 * 60 * 1000, "en", now)).toBe("3 days ago");
		expect(formatRelativeTime(now - 2 * 60 * 60 * 1000, "en", now)).toBe("2 hours ago");
	});

	it("非法时间戳不渲染", () => {
		expect(formatRelativeTime(0, "en", now)).toBeNull();
		expect(formatRelativeTime(Number.NaN, "en", now)).toBeNull();
	});
});
