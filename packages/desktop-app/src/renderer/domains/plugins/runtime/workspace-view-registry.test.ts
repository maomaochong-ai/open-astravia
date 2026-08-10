import type { RegisteredWorkspaceView } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import {
	findWorkspaceView,
	isValidWorkspaceViewId,
	parseWorkspaceViewNavKey,
	sortWorkspaceViews,
	workspaceViewNavKey,
	workspaceViewPath,
} from "./workspace-view-registry";

function view(pluginId: string, viewId: string, navOrder = 0): RegisteredWorkspaceView {
	return {
		pluginId,
		pluginName: pluginId,
		viewId,
		label: viewId,
		component: () => null,
		navOrder,
	};
}

describe("isValidWorkspaceViewId", () => {
	it("接受字母数字开头、含 . _ - 的 id", () => {
		expect(isValidWorkspaceViewId("board")).toBe(true);
		expect(isValidWorkspaceViewId("v2.board_main-x")).toBe(true);
	});

	it("拒绝会破坏 URL 段或布局 key 的 id", () => {
		for (const bad of ["", "-lead", ".dot", "a/b", "a b", "a?b", "a#b"]) {
			expect(isValidWorkspaceViewId(bad)).toBe(false);
		}
	});
});

describe("导航 key 与路由", () => {
	it("key 可以往返解析", () => {
		const key = workspaceViewNavKey("kanban", "board");
		expect(key).toBe("workspace:kanban/board");
		expect(parseWorkspaceViewNavKey(key)).toEqual({ pluginId: "kanban", viewId: "board" });
	});

	it("非工作区视图的 key 返回 null", () => {
		expect(parseWorkspaceViewNavKey("/automation")).toBeNull();
		expect(parseWorkspaceViewNavKey("new-session")).toBeNull();
		expect(parseWorkspaceViewNavKey("workspace:")).toBeNull();
		expect(parseWorkspaceViewNavKey("workspace:kanban")).toBeNull();
		expect(parseWorkspaceViewNavKey("workspace:/board")).toBeNull();
	});

	it("viewId 非法的 key 不被接受，避免拼出坏路由", () => {
		expect(parseWorkspaceViewNavKey("workspace:kanban/-bad")).toBeNull();
	});

	it("路由路径对每段做 URL 编码", () => {
		expect(workspaceViewPath("kanban", "board")).toBe("/workspace/kanban/board");
		expect(workspaceViewPath("my plugin", "board")).toBe("/workspace/my%20plugin/board");
	});
});

describe("findWorkspaceView", () => {
	const views = [view("kanban", "board"), view("other", "board")];

	it("按 pluginId + viewId 精确匹配", () => {
		expect(findWorkspaceView(views, "other", "board")?.pluginId).toBe("other");
	});

	it("缺参数、id 非法或未注册时返回 undefined", () => {
		expect(findWorkspaceView(views, undefined, "board")).toBeUndefined();
		expect(findWorkspaceView(views, "kanban", undefined)).toBeUndefined();
		expect(findWorkspaceView(views, "kanban", "a/b")).toBeUndefined();
		expect(findWorkspaceView(views, "kanban", "missing")).toBeUndefined();
	});
});

describe("sortWorkspaceViews", () => {
	it("先按 pluginId，再按 navOrder，最后按 viewId，且不改原数组", () => {
		const input = [view("b", "z", 0), view("a", "y", 5), view("a", "x", 1), view("a", "w", 1)];
		const sorted = sortWorkspaceViews(input);
		expect(sorted.map((item) => `${item.pluginId}/${item.viewId}`)).toEqual(["a/w", "a/x", "a/y", "b/z"]);
		expect(input[0].viewId).toBe("z");
	});
});
