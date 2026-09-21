import { describe, expect, it } from "vitest";
import {
	BOTTOM_PANEL_DEFAULT_HEIGHT_RATIO,
	BOTTOM_PANEL_MAX_HEIGHT_RATIO,
	BOTTOM_PANEL_SCHEMA_VERSION,
	type BottomPanelSessionState,
	collectBottomPanelLeaves,
	emptyBottomPanelState,
	reduceBottomPanel,
} from "./bottom-panel-layout";
import {
	BOTTOM_PANEL_SESSION_LIMIT,
	parseBottomPanelStates,
	renameBottomPanelStateKey,
	sanitizeBottomPanelState,
	serializeBottomPanelStates,
	touchBottomPanelState,
} from "./bottom-panel-persistence";

function oneTabState(): BottomPanelSessionState {
	return reduceBottomPanel(emptyBottomPanelState(), {
		type: "open-tab",
		tabId: "a",
		componentId: "terminal",
		newLeafId: "leaf-a",
	});
}

describe("序列化往返", () => {
	it("分屏后的布局树能原样读回", () => {
		const split = reduceBottomPanel(
			reduceBottomPanel(oneTabState(), { type: "open-tab", tabId: "b", componentId: "terminal", newLeafId: "x" }),
			{
				type: "split-leaf",
				leafId: "leaf-a",
				direction: "column",
				newLeafId: "below",
				newGroupId: "g1",
				content: { kind: "move-tab", tabId: "b" },
			},
		);

		const restored = parseBottomPanelStates(serializeBottomPanelStates(new Map([["s1", split]])));

		expect(restored.get("s1")).toEqual(split);
	});

	it("LRU 顺序在往返后保持", () => {
		const states = new Map([
			["old", oneTabState()],
			["new", oneTabState()],
		]);

		const restored = parseBottomPanelStates(serializeBottomPanelStates(states));

		expect([...restored.keys()]).toEqual(["old", "new"]);
	});
});

describe("读取不可信内容", () => {
	it("空值与坏 JSON 读成空表", () => {
		expect(parseBottomPanelStates(null).size).toBe(0);
		expect(parseBottomPanelStates("{not json").size).toBe(0);
	});

	it("版本不匹配的文件整体丢弃", () => {
		const raw = JSON.stringify({ version: 999, entries: [["s1", oneTabState()]] });

		expect(parseBottomPanelStates(raw).size).toBe(0);
	});

	it("schemaVersion 不匹配的单条状态被丢弃", () => {
		expect(sanitizeBottomPanelState({ ...oneTabState(), schemaVersion: 2 })).toBeNull();
	});

	it("空 tab 列表的格子会被丢掉，整条状态随之失效", () => {
		const broken = {
			schemaVersion: BOTTOM_PANEL_SCHEMA_VERSION,
			collapsed: false,
			heightRatio: 0.3,
			root: { kind: "leaf", id: "leaf-a", tabs: [], activeTabId: null },
			activeLeafId: "leaf-a",
		};

		expect(sanitizeBottomPanelState(broken)).toBeNull();
	});

	it("越界的高度比例被钳回区间，缺失时回默认值", () => {
		const tooTall = sanitizeBottomPanelState({ ...oneTabState(), heightRatio: 5 });
		const missing = sanitizeBottomPanelState({ ...oneTabState(), heightRatio: "half" });

		expect(tooTall?.heightRatio).toBe(BOTTOM_PANEL_MAX_HEIGHT_RATIO);
		expect(missing?.heightRatio).toBe(BOTTOM_PANEL_DEFAULT_HEIGHT_RATIO);
	});

	it("activeLeafId 指向不存在的格子时回退到第一格", () => {
		const state = sanitizeBottomPanelState({ ...oneTabState(), activeLeafId: "ghost" });

		expect(state?.activeLeafId).toBe("leaf-a");
	});

	it("只剩一个子节点的 group 在读取时塌缩成格子", () => {
		const raw = {
			schemaVersion: BOTTOM_PANEL_SCHEMA_VERSION,
			collapsed: false,
			heightRatio: 0.3,
			root: {
				kind: "group",
				id: "g1",
				direction: "row",
				children: [
					{ kind: "leaf", id: "leaf-a", tabs: [{ tabId: "a", componentId: "terminal" }], activeTabId: "a" },
				],
				sizes: [1],
			},
			activeLeafId: "leaf-a",
		};

		expect(sanitizeBottomPanelState(raw)?.root).toMatchObject({ kind: "leaf", id: "leaf-a" });
	});

	it("group 的 sizes 缺项时补齐并归一化", () => {
		const raw = {
			schemaVersion: BOTTOM_PANEL_SCHEMA_VERSION,
			collapsed: false,
			heightRatio: 0.3,
			root: {
				kind: "group",
				id: "g1",
				direction: "row",
				children: [
					{ kind: "leaf", id: "l1", tabs: [{ tabId: "a", componentId: "terminal" }], activeTabId: "a" },
					{ kind: "leaf", id: "l2", tabs: [{ tabId: "b", componentId: "terminal" }], activeTabId: "b" },
				],
				sizes: [],
			},
			activeLeafId: "l1",
		};

		const root = sanitizeBottomPanelState(raw)?.root;
		if (root?.kind !== "group") throw new Error("expected group");
		expect(root.sizes).toEqual([0.5, 0.5]);
		expect(collectBottomPanelLeaves(root)).toHaveLength(2);
	});
});

describe("touch 与 LRU 上限", () => {
	it("写入会把会话移到末尾", () => {
		const states = new Map([
			["s1", oneTabState()],
			["s2", oneTabState()],
		]);

		const next = touchBottomPanelState(states, "s1", oneTabState());

		expect([...next.keys()]).toEqual(["s2", "s1"]);
	});

	it("「展开了但还没加 tab」要存下来：否则点开面板这一步会丢", () => {
		const expandedEmpty = reduceBottomPanel(emptyBottomPanelState(), { type: "set-collapsed", collapsed: false });

		const next = touchBottomPanelState(new Map(), "s1", expandedEmpty);

		expect(next.get("s1")?.collapsed).toBe(false);
	});

	it("与默认状态一致时删键，不留空壳", () => {
		const next = touchBottomPanelState(new Map([["s1", oneTabState()]]), "s1", emptyBottomPanelState());

		expect(next.has("s1")).toBe(false);
	});

	it("超出上限时丢最旧的会话", () => {
		let states = new Map<string, BottomPanelSessionState>();
		for (let index = 0; index <= BOTTOM_PANEL_SESSION_LIMIT; index += 1) {
			states = touchBottomPanelState(states, `s${index}`, oneTabState());
		}

		expect(states.size).toBe(BOTTOM_PANEL_SESSION_LIMIT);
		expect(states.has("s0")).toBe(false);
		expect(states.has(`s${BOTTOM_PANEL_SESSION_LIMIT}`)).toBe(true);
	});
});

describe("新会话主键迁移", () => {
	it("把 new:cwd 上的面板改挂到真实 sessionPath", () => {
		const states = new Map([["new:/repo", oneTabState()]]);

		const next = renameBottomPanelStateKey(states, "new:/repo", "/repo/.vetta/s1.json");

		expect(next.has("new:/repo")).toBe(false);
		expect(next.get("/repo/.vetta/s1.json")).toEqual(oneTabState());
	});

	it("源主键没有面板时只是清掉旧键", () => {
		const states = new Map([["other", oneTabState()]]);

		const next = renameBottomPanelStateKey(states, "new:/repo", "/repo/s1.json");

		expect([...next.keys()]).toEqual(["other"]);
	});
});
