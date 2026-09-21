import {
	type BottomPanelSessionState,
	emptyBottomPanelState,
	reduceBottomPanel,
} from "@shared/store/bottom-panel-layout";
import { describe, expect, it } from "vitest";
import {
	canOpenBottomPanelComponent,
	countBottomPanelInstances,
	resolveBottomPanelPills,
	resolveBottomPanelTabs,
} from "./resolve-bottom-panel-tabs";
import type { BottomPanelComponentDefinition } from "./types";

const terminal: BottomPanelComponentDefinition = {
	id: "terminal",
	source: "builtin",
	defaultMeta: { label: "终端", icon: "icon-[solar--command-linear]" },
	component: () => null,
};

const singleton: BottomPanelComponentDefinition = {
	id: "plugin:demo:logs",
	source: "plugin",
	pluginId: "demo",
	maxInstances: 1,
	defaultMeta: { label: "日志" },
	component: () => null,
};

function withTabs(...ids: [string, string][]): BottomPanelSessionState {
	return ids.reduce<BottomPanelSessionState>(
		(state, [tabId, componentId], index) =>
			reduceBottomPanel(state, { type: "open-tab", tabId, componentId, newLeafId: `leaf-${index}` }),
		emptyBottomPanelState(),
	);
}

describe("resolveBottomPanelTabs", () => {
	it("没有实例 meta 时用定义的默认 meta，状态默认空闲", () => {
		const state = withTabs(["t1", "terminal"]);
		const tabs = resolveBottomPanelTabs({
			tabs: [{ tabId: "t1", componentId: "terminal" }],
			definitions: [terminal],
			metaById: {},
		});

		expect(state.root).not.toBeNull();
		expect(tabs).toHaveLength(1);
		expect(tabs[0]?.view).toMatchObject({ label: "终端", status: "idle" });
	});

	it("实例上报的 meta 覆盖默认值", () => {
		const tabs = resolveBottomPanelTabs({
			tabs: [{ tabId: "t1", componentId: "terminal" }],
			definitions: [terminal],
			metaById: { t1: { label: "zsh — repo", status: "active" } },
		});

		expect(tabs[0]?.view).toMatchObject({ label: "zsh — repo", status: "active" });
	});

	it("实例只改状态时保留定义的图标", () => {
		const tabs = resolveBottomPanelTabs({
			tabs: [{ tabId: "t1", componentId: "terminal" }],
			definitions: [terminal],
			metaById: { t1: { label: "zsh", status: "active" } },
		});

		expect(tabs[0]?.view.icon).toBe("icon-[solar--command-linear]");
	});

	it("组件已不存在的 tab 被跳过而不是让整块崩掉", () => {
		const tabs = resolveBottomPanelTabs({
			tabs: [
				{ tabId: "t1", componentId: "terminal" },
				{ tabId: "t2", componentId: "plugin:gone:panel" },
			],
			definitions: [terminal],
			metaById: {},
		});

		expect(tabs.map((entry) => entry.tabId)).toEqual(["t1"]);
	});
});

describe("resolveBottomPanelPills", () => {
	it("按树序平铺所有格子的 tab，与展开态共用同一份 meta", () => {
		const state = withTabs(["t1", "terminal"], ["t2", "terminal"]);

		const pills = resolveBottomPanelPills(state, [terminal], { t2: { label: "构建中", status: "active" } });

		expect(pills.map((pill) => pill.label)).toEqual(["终端", "构建中"]);
		expect(pills.map((pill) => pill.status)).toEqual(["idle", "active"]);
	});
});

describe("maxInstances", () => {
	it("统计同一组件已开实例数", () => {
		const state = withTabs(["t1", "terminal"], ["t2", "terminal"], ["t3", "plugin:demo:logs"]);

		expect(countBottomPanelInstances(state, "terminal")).toBe(2);
		expect(countBottomPanelInstances(state, "plugin:demo:logs")).toBe(1);
	});

	it("单例面板开过一个之后不再允许新开，不限的则一直允许", () => {
		const state = withTabs(["t1", "plugin:demo:logs"], ["t2", "terminal"]);

		expect(canOpenBottomPanelComponent(state, singleton)).toBe(false);
		expect(canOpenBottomPanelComponent(state, terminal)).toBe(true);
	});
});
