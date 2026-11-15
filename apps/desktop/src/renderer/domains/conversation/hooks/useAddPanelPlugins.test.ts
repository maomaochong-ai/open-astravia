import type { InstalledPlugin } from "@preload/api";
import { describe, expect, it } from "vitest";
import { projectPluginEntries } from "./useAddPanelPlugins";

function plugin(overrides: Partial<InstalledPlugin> & { id: string; name: string }): InstalledPlugin {
	return {
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "2.0.0",
		entryUrl: "",
		moduleFederation: { remoteName: overrides.id, expose: "./main" },
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "en",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "system",
		trustLevel: "trusted",
		rootPath: "/tmp/plugin",
		...overrides,
	} as InstalledPlugin;
}

describe("projectPluginEntries（ADR-0177 §4 插件归属）", () => {
	it("已安装且启用的插件才出现", () => {
		const entries = projectPluginEntries([
			plugin({ id: "lark", name: "飞书套件" }),
			plugin({ id: "old", name: "停用的插件", enabled: false }),
		]);
		expect(entries.map((entry) => entry.id)).toEqual(["lark"]);
	});

	it("按名称排序，位置在两次打开之间稳定", () => {
		const entries = projectPluginEntries([plugin({ id: "b", name: "Beta" }), plugin({ id: "a", name: "Alpha" })]);
		expect(entries.map((entry) => entry.label)).toEqual(["Alpha", "Beta"]);
	});

	it("`%key%` 形式的名称按插件自己的 catalog 解析，不显示裸占位符", () => {
		const entries = projectPluginEntries(
			[
				plugin({
					id: "lark",
					name: "%plugin.name%",
					description: "%plugin.description%",
					locales: { zh: { "plugin.name": "飞书套件", "plugin.description": "文档与日历" } },
					defaultLocale: "zh",
				}),
			],
			"zh",
		);
		expect(entries[0]?.label).toBe("飞书套件");
		expect(entries[0]?.description).toBe("文档与日历");
	});

	it("把 main 解析好的 iconUrl 带出去（目录投影再区分 class 与图片）", () => {
		const entries = projectPluginEntries([
			plugin({ id: "lark", name: "飞书套件", iconUrl: "astravia-plugin://lark/icon.png" }),
		]);
		expect(entries[0]?.icon).toBe("astravia-plugin://lark/icon.png");
	});
});
