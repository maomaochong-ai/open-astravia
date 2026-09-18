import type { SidebarNavItem } from "@vetta-org/theme-sdk/sidebar";
import { describe, expect, it } from "vitest";
import {
	commandMenuActionPrefetchKey,
	IDLE_PREFETCH_KEYS,
	navItemPrefetchKey,
	PINNED_PREFETCH_KEYS,
} from "./route-prefetch";

function item(overrides: Partial<SidebarNavItem>): SidebarNavItem {
	return {
		active: false,
		icon: "icon-[solar--widget-linear]",
		key: "k",
		type: "route",
		...overrides,
	};
}

describe("navItemPrefetchKey", () => {
	it("把侧栏入口映射到对应路由 chunk", () => {
		expect(navItemPrefetchKey(item({ path: "/abilities" }))).toBe("/abilities");
		expect(navItemPrefetchKey(item({ path: "/skills" }))).toBe("/abilities");
		expect(navItemPrefetchKey(item({ path: "/agents" }))).toBe("/agents");
		expect(navItemPrefetchKey(item({ path: "/knowledge" }))).toBe("/knowledge");
		expect(navItemPrefetchKey(item({ settingsTab: "appearance", type: "route" }))).toBe("settings");
		expect(navItemPrefetchKey(item({ type: "new-session" }))).toBe("new-session");
		expect(navItemPrefetchKey(item({ type: "custom", workspaceView: { pluginId: "p", viewId: "v" } }))).toBe(
			"workspace",
		);
	});

	it("无法预取的入口返回 null", () => {
		expect(navItemPrefetchKey(item({ type: "custom", key: "unknown" }))).toBeNull();
	});
});

describe("PINNED_PREFETCH_KEYS", () => {
	it("侧栏默认置顶入口（设计、能力、智能体）排在立刻预取队列", () => {
		expect(PINNED_PREFETCH_KEYS).toEqual(["workspace", "/abilities", "/agents", "new-session", "settings"]);
		expect(IDLE_PREFETCH_KEYS).not.toContain("workspace");
		expect(IDLE_PREFETCH_KEYS).toContain("team-chat");
		expect(IDLE_PREFETCH_KEYS).toContain("/knowledge/all");
	});
});

describe("commandMenuActionPrefetchKey", () => {
	it("只预取会跳到懒加载页的命令菜单动作", () => {
		expect(commandMenuActionPrefetchKey("openSettingsSection")).toBe("settings");
		expect(commandMenuActionPrefetchKey("openAbilities")).toBe("/abilities");
		expect(commandMenuActionPrefetchKey("openWorkspaceView")).toBe("workspace");
		expect(commandMenuActionPrefetchKey("openSession")).toBeNull();
		expect(commandMenuActionPrefetchKey("openProject")).toBeNull();
	});
});
