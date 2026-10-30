// @vitest-environment jsdom

import type { PluginPermission } from "@astravia-org/plugin-sdk";
import type { InstalledPlugin } from "@preload/api";
import { sidebarCollapsedAtom } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginUiApi } from "./plugin-ui-context";

function createUi(permissions: PluginPermission[]) {
	const plugin = {
		id: "demo-plugin",
		name: "Demo",
		permissions,
		grantedPermissions: permissions,
	} as unknown as InstalledPlugin;
	return createPluginUiApi({
		plugin,
		contributions: new PluginLocalContributions(),
		onChanged: () => {},
		disposers: [],
		agentContributions: { handlers: [] } as never,
		capabilitySessionId: "session-1",
	});
}

afterEach(() => {
	getDefaultStore().set(sidebarCollapsedAtom, false);
	vi.restoreAllMocks();
});

describe("setSidebarCollapsed", () => {
	it("有 ui.sidebar.control 权限时改变侧边栏状态并通知订阅者", () => {
		const ui = createUi(["ui.sidebar.control"]);
		const seen: boolean[] = [];
		const sub = ui.onSidebarStateChanged((state) => seen.push(state.collapsed));
		ui.setSidebarCollapsed(true);
		expect(getDefaultStore().get(sidebarCollapsedAtom)).toBe(true);
		ui.setSidebarCollapsed(false);
		expect(getDefaultStore().get(sidebarCollapsedAtom)).toBe(false);
		sub.dispose();
		expect(seen).toEqual([true, false]);
	});

	it("没有权限时不改变状态", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const ui = createUi([]);
		ui.setSidebarCollapsed(true);
		expect(getDefaultStore().get(sidebarCollapsedAtom)).toBe(false);
	});

	it("拒绝非布尔参数", () => {
		const ui = createUi(["ui.sidebar.control"]);
		expect(() => ui.setSidebarCollapsed("yes" as unknown as boolean)).toThrow();
	});
});
