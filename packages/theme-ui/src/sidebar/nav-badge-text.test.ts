import { describe, expect, it } from "vitest";
import { navBadgeText } from "./nav-badge-text";

describe("navBadgeText", () => {
	it("计数超过 99 收成 99+，导航项宽度撑不下真实数字", () => {
		expect(navBadgeText({ kind: "count", count: 99 })).toBe("99");
		expect(navBadgeText({ kind: "count", count: 100 })).toBe("99+");
		expect(navBadgeText({ kind: "count", count: 4321 })).toBe("99+");
	});

	it("计数归零就不出角标，而不是挂一个 0", () => {
		expect(navBadgeText({ kind: "count", count: 0 })).toBeNull();
	});

	it("dot 没有文本", () => {
		expect(navBadgeText({ kind: "dot" })).toBeNull();
	});

	it("text 去空白；只有空白就不出角标", () => {
		expect(navBadgeText({ kind: "text", text: " Beta " })).toBe("Beta");
		expect(navBadgeText({ kind: "text", text: "   " })).toBeNull();
	});
});
