import type { RegisteredWorkspaceView } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import {
	findWorkspaceView,
	isValidWorkspaceViewId,
	normalizePluginNavBadge,
	parseWorkspaceViewNavKey,
	sortWorkspaceViews,
	workspaceViewNavKey,
	workspaceViewPath,
} from "./workspace-view-registry";

function view(overrides: Partial<RegisteredWorkspaceView>): RegisteredWorkspaceView {
	return {
		pluginId: "demo",
		pluginName: "Demo",
		viewId: "board",
		label: "Board",
		component: () => null,
		navOrder: 0,
		...overrides,
	};
}

describe("isValidWorkspaceViewId", () => {
	it("accepts conservative ids", () => {
		expect(isValidWorkspaceViewId("gallery")).toBe(true);
		expect(isValidWorkspaceViewId("my-view_2.board")).toBe(true);
	});
	it("rejects empty, leading-dot/dash and path-ish ids", () => {
		expect(isValidWorkspaceViewId("")).toBe(false);
		expect(isValidWorkspaceViewId("-lead")).toBe(false);
		expect(isValidWorkspaceViewId(".dot")).toBe(false);
		expect(isValidWorkspaceViewId("a/b")).toBe(false);
		expect(isValidWorkspaceViewId("a b")).toBe(false);
		expect(isValidWorkspaceViewId("a?b")).toBe(false);
		expect(isValidWorkspaceViewId("a#b")).toBe(false);
	});
});

describe("workspace view nav key round-trip", () => {
	it("round-trips a valid key", () => {
		const key = workspaceViewNavKey("kanban", "board");
		expect(key).toBe("workspace:kanban/board");
		expect(parseWorkspaceViewNavKey(key)).toEqual({ pluginId: "kanban", viewId: "board" });
	});
	it("returns null for non-workspace keys", () => {
		expect(parseWorkspaceViewNavKey("/abilities")).toBeNull();
		expect(parseWorkspaceViewNavKey("")).toBeNull();
	});
	it("rejects a key with an invalid viewId", () => {
		expect(parseWorkspaceViewNavKey("workspace:kanban/a/b")).toBeNull();
		expect(parseWorkspaceViewNavKey("workspace:kanban/")).toBeNull();
	});
});

describe("workspaceViewPath", () => {
	it("builds the route path with URL-encoded segments", () => {
		expect(workspaceViewPath("my plugin", "board")).toBe("/workspace/my%20plugin/board");
		expect(workspaceViewPath("demo", "gallery")).toBe("/workspace/demo/gallery");
	});
});

describe("findWorkspaceView", () => {
	const views = [view({ viewId: "board" }), view({ pluginId: "other", viewId: "board" })];
	it("matches pluginId + viewId exactly", () => {
		expect(findWorkspaceView(views, "demo", "board")?.viewId).toBe("board");
		expect(findWorkspaceView(views, "other", "board")?.pluginId).toBe("other");
	});
	it("returns undefined for unknown or invalid ids", () => {
		expect(findWorkspaceView(views, "demo", "nope")).toBeUndefined();
		expect(findWorkspaceView(views, undefined, "board")).toBeUndefined();
		expect(findWorkspaceView(views, "demo", "a/b")).toBeUndefined();
	});
});

describe("normalizePluginNavBadge", () => {
	it("normalizes every kind and drops unknown input", () => {
		expect(normalizePluginNavBadge({ kind: "beta" })).toEqual({ kind: "beta" });
		expect(normalizePluginNavBadge({ kind: "dot" })).toEqual({ kind: "dot" });
		expect(normalizePluginNavBadge({ kind: "dot", tone: "danger" })).toEqual({ kind: "dot", tone: "danger" });
		expect(normalizePluginNavBadge({ kind: "count", count: 3.7 })).toEqual({ kind: "count", count: 3 });
		expect(normalizePluginNavBadge({ kind: "count", count: -2 })).toEqual({ kind: "count", count: 0 });
		expect(normalizePluginNavBadge({ kind: "count", count: NaN })).toBeUndefined();
		expect(normalizePluginNavBadge({ kind: "text", text: "  hot  " })).toEqual({ kind: "text", text: "hot" });
		expect(normalizePluginNavBadge({ kind: "text", text: "  " })).toBeUndefined();
		expect(normalizePluginNavBadge({ kind: "nope" })).toBeUndefined();
		expect(normalizePluginNavBadge(null)).toBeUndefined();
		expect(normalizePluginNavBadge({ kind: "text", text: "x", tone: "unknown" })).toEqual({
			kind: "text",
			text: "x",
		});
	});
});

describe("sortWorkspaceViews", () => {
	it("sorts by pluginId, then navOrder, then viewId — stable", () => {
		const views = [
			view({ pluginId: "b", viewId: "z", navOrder: 0 }),
			view({ pluginId: "a", viewId: "m", navOrder: 1 }),
			view({ pluginId: "a", viewId: "a", navOrder: 0 }),
			view({ pluginId: "a", viewId: "b", navOrder: 0 }),
		];
		expect(sortWorkspaceViews(views).map((v) => `${v.pluginId}:${v.viewId}`)).toEqual(["a:a", "a:b", "a:m", "b:z"]);
	});
});
