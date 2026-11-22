import { describe, expect, it } from "vitest";
import { APP_ICON_IDS, appIconFileSuffix, isAppIconId, normalizeAppIconId } from "./app-icon";

describe("appIconFileSuffix", () => {
	it("picks the framing that matches each platform's icon grid", () => {
		// 任务栏/桌面按画布排版：Windows 要贴满的 -win，macOS 要贴 Apple 网格的 -mac。
		expect(appIconFileSuffix("win32")).toBe("-win");
		expect(appIconFileSuffix("darwin")).toBe("-mac");
		expect(appIconFileSuffix("linux")).toBe("");
		expect(appIconFileSuffix("freebsd")).toBe("");
	});
});

describe("normalizeAppIconId", () => {
	it("keeps known ids and falls back to the factory icon", () => {
		expect(normalizeAppIconId("coding")).toBe("coding");
		expect(normalizeAppIconId("nope")).toBe("default");
		expect(normalizeAppIconId(undefined)).toBe("default");
		expect(isAppIconId("sleep")).toBe(true);
	});

	it("lists the factory icon first so existing configs stay valid", () => {
		expect(APP_ICON_IDS[0]).toBe("default");
		expect(APP_ICON_IDS).toHaveLength(11);
	});
});
