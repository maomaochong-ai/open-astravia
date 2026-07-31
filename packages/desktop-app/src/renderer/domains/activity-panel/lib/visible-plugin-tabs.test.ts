import type { RegisteredActivityTab, RegisteredInputAction } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { hardIsolationOffPluginIds, selectVisiblePluginTabs } from "./visible-plugin-tabs";

function tab(pluginId: string, tabId: string, scope_use?: RegisteredActivityTab["scope_use"]): RegisteredActivityTab {
	return {
		pluginId,
		pluginName: pluginId,
		tabId,
		label: tabId,
		component: () => null,
		scope_use,
	};
}

function action(pluginId: string, hardIsolation: boolean): RegisteredInputAction {
	return { pluginId, actionId: `${pluginId}:mode`, label: "mode", hardIsolation };
}

describe("selectVisiblePluginTabs", () => {
	const gitTab = tab("git", "changes", ["project"]);
	const workbenchTab = tab("plugin-workbench", "workbench", ["project", "conversation"]);
	const base = { enabled: true, scenario: "project" as const, isolationOffPluginIds: new Set<string>() };

	// 回归：插件注册的标签卡无需任何 attach 记录即应渲染。曾因加回 attach 过滤
	// （"+"下拉已无 attach 入口）导致 git 面板 / 插件工作台标签卡永久消失。
	it("shows registered tabs without any attach record", () => {
		expect(selectVisiblePluginTabs({ ...base, tabs: [gitTab, workbenchTab] })).toEqual([gitTab, workbenchTab]);
	});

	it("drops tabs outside the current scenario, fail-closed when scope_use is missing", () => {
		const noScope = tab("x", "y");
		expect(
			selectVisiblePluginTabs({ ...base, scenario: "conversation", tabs: [gitTab, workbenchTab, noScope] }),
		).toEqual([workbenchTab]);
	});

	it("returns nothing when the scenario is unknown or plugin tabs are disabled", () => {
		expect(selectVisiblePluginTabs({ ...base, scenario: null, tabs: [gitTab] })).toEqual([]);
		expect(selectVisiblePluginTabs({ ...base, enabled: false, tabs: [gitTab] })).toEqual([]);
	});

	it("hides tabs of plugins whose hard-isolation toggle is off (ADR-0041)", () => {
		const isolationOffPluginIds = new Set(["plugin-workbench"]);
		expect(selectVisiblePluginTabs({ ...base, tabs: [gitTab, workbenchTab], isolationOffPluginIds })).toEqual([
			gitTab,
		]);
	});
});

describe("hardIsolationOffPluginIds", () => {
	it("collects only hard-isolation plugins whose toggle is inactive", () => {
		const actions = [action("plugin-workbench", true), action("git", false)];
		expect(hardIsolationOffPluginIds(actions, new Set())).toEqual(new Set(["plugin-workbench"]));
		expect(hardIsolationOffPluginIds(actions, new Set(["plugin-workbench:mode"]))).toEqual(new Set());
	});
});
