import { describe, expect, it } from "vitest";
import {
	activeBottomPanelTab,
	BOTTOM_PANEL_MAX_HEIGHT_RATIO,
	BOTTOM_PANEL_MAX_LEAVES,
	BOTTOM_PANEL_MIN_HEIGHT_RATIO,
	type BottomPanelAction,
	type BottomPanelGroup,
	type BottomPanelSessionState,
	canSplitBottomPanel,
	collectBottomPanelLeaves,
	emptyBottomPanelState,
	findBottomPanelTab,
	isDefaultBottomPanelState,
	latestBottomPanelTabOf,
	reduceBottomPanel,
} from "./bottom-panel-layout";

function run(state: BottomPanelSessionState, ...actions: BottomPanelAction[]): BottomPanelSessionState {
	return actions.reduce(reduceBottomPanel, state);
}

function openTerminal(id: string, leafId?: string): BottomPanelAction {
	return { type: "open-tab", tabId: id, componentId: "terminal", newLeafId: `leaf-${id}`, leafId };
}

/** 两个 tab 的单格子面板：几乎所有分屏/关闭场景都从这里开始。 */
function withTwoTabs(): BottomPanelSessionState {
	return run(emptyBottomPanelState(), openTerminal("a"), openTerminal("b"));
}

function asGroup(state: BottomPanelSessionState): BottomPanelGroup {
	if (state.root?.kind !== "group") throw new Error("expected root to be a group");
	return state.root;
}

describe("open-tab", () => {
	it("首个 tab 建出根格子并展开面板", () => {
		const state = run(emptyBottomPanelState(), openTerminal("a"));

		expect(state.collapsed).toBe(false);
		expect(state.root).toEqual({
			kind: "leaf",
			id: "leaf-a",
			tabs: [{ tabId: "a", componentId: "terminal" }],
			activeTabId: "a",
		});
		expect(state.activeLeafId).toBe("leaf-a");
	});

	it("后续 tab 追加到当前激活格子并成为激活 tab", () => {
		const state = withTwoTabs();
		const leaves = collectBottomPanelLeaves(state.root);

		expect(leaves).toHaveLength(1);
		expect(leaves[0]?.tabs.map((tab) => tab.tabId)).toEqual(["a", "b"]);
		expect(leaves[0]?.activeTabId).toBe("b");
	});

	it("指定 leafId 时落到那一格", () => {
		const split = run(withTwoTabs(), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "b" },
		});

		const state = run(split, openTerminal("c", "leaf-a"));

		expect(findBottomPanelTab(state.root, "c")?.leaf.id).toBe("leaf-a");
		expect(state.activeLeafId).toBe("leaf-a");
	});
});

describe("close-tab", () => {
	it("关掉激活 tab 后激活同位置的邻居", () => {
		const state = run(withTwoTabs(), { type: "activate-tab", tabId: "a" }, { type: "close-tab", tabId: "a" });

		expect(collectBottomPanelLeaves(state.root)[0]?.activeTabId).toBe("b");
	});

	it("关掉最后一个 tab 后面板变空并自动收起", () => {
		const state = run(emptyBottomPanelState(), openTerminal("a"), { type: "close-tab", tabId: "a" });

		expect(state.root).toBeNull();
		expect(state.activeLeafId).toBeNull();
		expect(state.collapsed).toBe(true);
	});

	it("还剩 tab 时关闭不改变展开态", () => {
		const state = run(withTwoTabs(), { type: "close-tab", tabId: "a" });

		expect(state.collapsed).toBe(false);
	});

	it("空掉的格子被回收，单子 group 塌缩回格子", () => {
		const split = run(withTwoTabs(), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "b" },
		});
		expect(split.root?.kind).toBe("group");

		const state = run(split, { type: "close-tab", tabId: "b" });

		expect(state.root).toMatchObject({ kind: "leaf", id: "leaf-a" });
		expect(state.activeLeafId).toBe("leaf-a");
	});

	it("未知 tabId 不改变状态", () => {
		const before = withTwoTabs();

		expect(run(before, { type: "close-tab", tabId: "missing" })).toBe(before);
	});
});

describe("split-leaf", () => {
	it("把一个 tab 拆到新格子，两格各占一半", () => {
		const state = run(withTwoTabs(), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "b" },
		});

		const group = asGroup(state);
		expect(group.direction).toBe("row");
		expect(group.sizes).toEqual([0.5, 0.5]);
		expect(collectBottomPanelLeaves(group).map((leaf) => leaf.id)).toEqual(["leaf-a", "right"]);
		expect(state.activeLeafId).toBe("right");
	});

	it("只剩一个 tab 的格子不能靠搬走 tab 分屏", () => {
		const before = run(emptyBottomPanelState(), openTerminal("a"));

		const state = run(before, {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "a" },
		});

		expect(state).toBe(before);
	});

	it("单 tab 格子可以分出一个新建 tab", () => {
		const state = run(run(emptyBottomPanelState(), openTerminal("a")), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "new-tab", tabId: "b", componentId: "terminal" },
		});

		expect(collectBottomPanelLeaves(state.root)).toHaveLength(2);
		expect(findBottomPanelTab(state.root, "b")?.leaf.id).toBe("right");
	});

	it("同方向再分屏插成兄弟而不是继续嵌套", () => {
		const first = run(withTwoTabs(), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "b" },
		});
		const withThird = run(first, openTerminal("c", "leaf-a"));

		const state = run(withThird, {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "third",
			newGroupId: "g2",
			content: { kind: "move-tab", tabId: "c" },
		});

		const group = asGroup(state);
		expect(group.id).toBe("g1");
		expect(group.children).toHaveLength(3);
		expect(group.children.every((child) => child.kind === "leaf")).toBe(true);
		expect(group.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
	});

	it("达到格子数上限后拒绝继续分屏", () => {
		let state = run(emptyBottomPanelState(), openTerminal("t0"));
		for (let index = 1; index < BOTTOM_PANEL_MAX_LEAVES; index += 1) {
			state = run(state, {
				type: "split-leaf",
				leafId: `leaf-t${index - 1}`,
				direction: "row",
				newLeafId: `leaf-t${index}`,
				newGroupId: `g${index}`,
				content: { kind: "new-tab", tabId: `t${index}`, componentId: "terminal" },
			});
		}
		expect(collectBottomPanelLeaves(state.root)).toHaveLength(BOTTOM_PANEL_MAX_LEAVES);
		expect(canSplitBottomPanel(state)).toBe(false);

		const rejected = run(state, {
			type: "split-leaf",
			leafId: `leaf-t${BOTTOM_PANEL_MAX_LEAVES - 1}`,
			direction: "row",
			newLeafId: "overflow",
			newGroupId: "g-overflow",
			content: { kind: "new-tab", tabId: "overflow", componentId: "terminal" },
		});

		expect(rejected).toBe(state);
	});

	it("不同方向分屏才嵌套出新 group", () => {
		const first = run(withTwoTabs(), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "b" },
		});
		const withThird = run(first, openTerminal("c", "leaf-a"));

		const state = run(withThird, {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "column",
			newLeafId: "below",
			newGroupId: "g2",
			content: { kind: "move-tab", tabId: "c" },
		});

		const group = asGroup(state);
		expect(group.id).toBe("g1");
		expect(group.children[0]).toMatchObject({ kind: "group", id: "g2", direction: "column" });
	});
});

describe("move-tab", () => {
	it("同格子内换序", () => {
		const state = run(withTwoTabs(), { type: "move-tab", tabId: "b", targetLeafId: "leaf-a", targetIndex: 0 });

		expect(collectBottomPanelLeaves(state.root)[0]?.tabs.map((tab) => tab.tabId)).toEqual(["b", "a"]);
	});

	it("跨格子迁移并激活目标格", () => {
		const split = run(withTwoTabs(), openTerminal("c"), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "c" },
		});

		const state = run(split, { type: "move-tab", tabId: "b", targetLeafId: "right", targetIndex: 0 });

		expect(findBottomPanelTab(state.root, "b")?.leaf.id).toBe("right");
		expect(state.activeLeafId).toBe("right");
	});

	it("把源格子搬空时格子被回收，树随之塌缩", () => {
		const split = run(withTwoTabs(), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "b" },
		});

		const state = run(split, { type: "move-tab", tabId: "b", targetLeafId: "leaf-a", targetIndex: 1 });

		expect(state.root).toMatchObject({ kind: "leaf", id: "leaf-a" });
		expect(collectBottomPanelLeaves(state.root)[0]?.tabs.map((tab) => tab.tabId)).toEqual(["a", "b"]);
	});
});

describe("resize-group", () => {
	function twoColumns(): BottomPanelSessionState {
		return run(withTwoTabs(), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "b" },
		});
	}

	it("把差额从右侧挪到左侧，总和保持 1", () => {
		const state = run(twoColumns(), { type: "resize-group", groupId: "g1", index: 0, delta: 0.2 });

		const group = asGroup(state);
		expect(group.sizes[0]).toBeCloseTo(0.7);
		expect(group.sizes[1]).toBeCloseTo(0.3);
	});

	it("拖到底仍给两侧留最小占比", () => {
		const state = run(twoColumns(), { type: "resize-group", groupId: "g1", index: 0, delta: 5 });

		const group = asGroup(state);
		expect(group.sizes[1]).toBeGreaterThan(0);
		expect(group.sizes[0] ?? 0).toBeLessThan(1);
	});

	it("未知 groupId 不改变状态", () => {
		const before = twoColumns();

		expect(run(before, { type: "resize-group", groupId: "nope", index: 0, delta: 0.2 })).toBe(before);
	});
});

describe("height / collapsed / payload", () => {
	it("高度比例被钳在允许区间内", () => {
		expect(run(emptyBottomPanelState(), { type: "set-height-ratio", ratio: 0.99 }).heightRatio).toBe(
			BOTTOM_PANEL_MAX_HEIGHT_RATIO,
		);
		expect(run(emptyBottomPanelState(), { type: "set-height-ratio", ratio: 0.01 }).heightRatio).toBe(
			BOTTOM_PANEL_MIN_HEIGHT_RATIO,
		);
	});

	it("折叠开关与 payload 写入", () => {
		const state = run(
			withTwoTabs(),
			{ type: "set-collapsed", collapsed: true },
			{
				type: "set-payload",
				tabId: "a",
				payload: { cwd: "/tmp" },
			},
		);

		expect(state.collapsed).toBe(true);
		expect(findBottomPanelTab(state.root, "a")?.tab.payload).toEqual({ cwd: "/tmp" });
	});
});

describe("prune", () => {
	it("丢掉组件已不存在的 tab，并在清空后折叠面板", () => {
		const state = run(withTwoTabs(), openTerminal("p"), { type: "prune", knownComponentIds: [] });

		expect(state.root).toBeNull();
		expect(state.collapsed).toBe(true);
		expect(state.activeLeafId).toBeNull();
	});

	it("只丢未知组件的 tab，保留其余结构", () => {
		const withPlugin = run(withTwoTabs(), {
			type: "open-tab",
			tabId: "p",
			componentId: "plugin:demo:panel",
			newLeafId: "leaf-p",
		});

		const state = run(withPlugin, { type: "prune", knownComponentIds: ["terminal"] });

		expect(findBottomPanelTab(state.root, "p")).toBeNull();
		expect(collectBottomPanelLeaves(state.root)[0]?.tabs.map((tab) => tab.tabId)).toEqual(["a", "b"]);
	});

	it("全部组件都在时状态不变", () => {
		const before = withTwoTabs();

		expect(run(before, { type: "prune", knownComponentIds: ["terminal"] })).toBe(before);
	});
});

describe("最近激活的 tab", () => {
	function openPlugin(id: string): BottomPanelAction {
		return { type: "open-tab", tabId: id, componentId: "plugin:p:logs", newLeafId: `leaf-${id}` };
	}

	it("按组件分别记下最后在用的实例", () => {
		const state = run(withTwoTabs(), { type: "activate-tab", tabId: "a" }, openPlugin("p1"));

		expect(state.lastActiveTabIds).toEqual({ terminal: "a", "plugin:p:logs": "p1" });
		expect(activeBottomPanelTab(state)?.tabId).toBe("p1");
		expect(latestBottomPanelTabOf(state, "terminal")?.tabId).toBe("a");
	});

	it("聚焦分屏里的另一格也算用过那一格的激活 tab", () => {
		const split = run(withTwoTabs(), {
			type: "split-leaf",
			leafId: "leaf-a",
			direction: "row",
			newLeafId: "right",
			newGroupId: "g1",
			content: { kind: "move-tab", tabId: "b" },
		});
		expect(latestBottomPanelTabOf(split, "terminal")?.tabId).toBe("b");

		const state = run(split, { type: "focus-leaf", leafId: "leaf-a" });

		expect(latestBottomPanelTabOf(state, "terminal")?.tabId).toBe("a");
	});

	it("记录的 tab 关掉后退回布局顺序里最后一个同类实例", () => {
		const state = run(
			withTwoTabs(),
			openPlugin("p1"),
			{ type: "activate-tab", tabId: "a" },
			{ type: "activate-tab", tabId: "p1" },
			{ type: "close-tab", tabId: "a" },
		);

		expect(state.lastActiveTabIds).toEqual({ "plugin:p:logs": "p1" });
		expect(latestBottomPanelTabOf(state, "terminal")?.tabId).toBe("b");
	});

	it("没有同类实例时返回 null", () => {
		expect(latestBottomPanelTabOf(run(emptyBottomPanelState(), openPlugin("p1")), "terminal")).toBeNull();
	});

	it("全部关掉后记录清空，状态回到默认形状", () => {
		const state = run(emptyBottomPanelState(), openTerminal("a"), { type: "close-tab", tabId: "a" });

		expect(state.lastActiveTabIds).toBeUndefined();
		expect(isDefaultBottomPanelState(state)).toBe(true);
	});

	it("与在用 tab 无关的动作不换状态引用", () => {
		const state = withTwoTabs();

		expect(reduceBottomPanel(state, { type: "set-height-ratio", ratio: 0.5 }).lastActiveTabIds).toBe(
			state.lastActiveTabIds,
		);
	});
});
