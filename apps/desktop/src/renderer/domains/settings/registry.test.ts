import { describe, expect, it } from "vitest";
import enSettings from "../../../shared/i18n/locales/en/settings.json";
import zhSettings from "../../../shared/i18n/locales/zh/settings.json";
import {
	filterVisibleSettingsTabs,
	SETTINGS_SECTIONS,
	SETTINGS_TABS,
	type SettingsTabVisibilityContext,
} from "./registry";

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
	it("远程连接在所有平台上出现", () => {
		expect(visibleKeys({ isWindows: true })).toContain("remote");
		expect(visibleKeys({ isMac: true })).toContain("remote");
		expect(visibleKeys({})).toContain("remote");
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

describe("更多选项入口", () => {
	it("排在标签列表最后", () => {
		expect(SETTINGS_TABS.at(-1)?.key).toBe("extensions");
	});

	it("不带平台或登录限制，任何环境都能进插件页面", () => {
		expect(visibleKeys({})).toContain("extensions");
		expect(visibleKeys({ hasAuthUser: false, isPersonal: false })).toContain("extensions");
	});
});

/**
 * 分区的标题在命令面板里是 `t(titleKey)` 直接渲染的：文案文件里少一条，用户看到的
 * 就是这串 key 本身（中英都缺译时回退链会落到 key，与 ADR-0031 的约定相悖）。这里按
 * 注册表逐条核对，避免新增分区时注册与文案两边脱节。
 */
function lookup(bundle: Record<string, unknown>, dottedKey: string): unknown {
	return dottedKey.split(".").reduce<unknown>((node, part) => {
		if (node && typeof node === "object" && part in node) {
			return (node as Record<string, unknown>)[part];
		}
		return undefined;
	}, bundle);
}

describe("设置标题文案", () => {
	it("每个分区的 titleKey 在中英文案里都有译文", () => {
		for (const section of SETTINGS_SECTIONS) {
			const key: string | undefined = section.titleKey;
			expect(key, `设置分区 ${section.id} 缺少 titleKey`).toBeTruthy();
			if (!key) continue;
			expect(lookup(enSettings, key), `en/settings.json 缺少 ${key}`).toBeTypeOf("string");
			expect(lookup(zhSettings, key), `zh/settings.json 缺少 ${key}`).toBeTypeOf("string");
		}
	});

	it("每个侧栏标签的 labelKey 在中英文案里都有译文", () => {
		for (const tab of SETTINGS_TABS) {
			expect(lookup(enSettings, tab.labelKey), `en/settings.json 缺少 ${tab.labelKey}`).toBeTypeOf("string");
			expect(lookup(zhSettings, tab.labelKey), `zh/settings.json 缺少 ${tab.labelKey}`).toBeTypeOf("string");
		}
	});
});
