import { describe, expect, it } from "vitest";
import { filterVisibleSettingsTabs, SETTINGS_TABS, type SettingsTabVisibilityContext } from "./registry";

const BASE: SettingsTabVisibilityContext = {
	isPersonal: true,
	hasAuthUser: true,
	isMac: false,
	isWindows: false,
};

function visibleKeys(context: Partial<SettingsTabVisibilityContext>): string[] {
	return filterVisibleSettingsTabs(SETTINGS_TABS, { ...BASE, ...context }).map((tab) => tab.key);
}

describe("设置标签可见性", () => {
	it("远程连接仅在 Windows 上出现", () => {
		expect(visibleKeys({ isWindows: true })).toContain("remote");
		expect(visibleKeys({ isMac: true })).not.toContain("remote");
		expect(visibleKeys({})).not.toContain("remote");
	});

	it("macOnly 标签仅在 Mac 上出现", () => {
		expect(visibleKeys({ isMac: true })).toEqual(expect.arrayContaining(["appshot", "permissions"]));
		expect(visibleKeys({ isWindows: true })).not.toContain("appshot");
		expect(visibleKeys({ isWindows: true })).not.toContain("permissions");
	});

	it("未登录时隐藏需要登录的标签，与平台无关", () => {
		expect(visibleKeys({ hasAuthUser: false, isWindows: true })).not.toContain("account");
		expect(visibleKeys({ hasAuthUser: true, isWindows: true })).toContain("account");
	});

	it("无平台限制的标签在任何平台都可见", () => {
		for (const context of [{ isMac: true }, { isWindows: true }, {}]) {
			expect(visibleKeys(context)).toEqual(expect.arrayContaining(["general", "appearance", "models"]));
		}
	});
});
