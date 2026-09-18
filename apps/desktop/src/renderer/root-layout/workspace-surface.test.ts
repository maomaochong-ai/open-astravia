import { describe, expect, it } from "vitest";
import {
	MAX_RESIDENT_WORKSPACE_SURFACES,
	rememberVisitedWorkspace,
	workspaceSurfaceForPath,
} from "./workspace-surface";

describe("workspaceSurfaceForPath", () => {
	it("把侧栏设计画廊解析成可保活的工作区 surface", () => {
		expect(workspaceSurfaceForPath("/workspace/vetta-ui-design/gallery")).toEqual({
			pluginId: "vetta-ui-design",
			viewId: "gallery",
			key: "vetta-ui-design/gallery",
		});
	});

	it("解码 URL 段，拒绝缺段或非法编码", () => {
		expect(workspaceSurfaceForPath("/workspace/a%2Fb/view")).toEqual({
			pluginId: "a/b",
			viewId: "view",
			key: "a/b/view",
		});
		expect(workspaceSurfaceForPath("/workspace/only-plugin")).toBeNull();
		expect(workspaceSurfaceForPath("/workspace/a/b/extra")).toBeNull();
		expect(workspaceSurfaceForPath("/settings")).toBeNull();
		expect(workspaceSurfaceForPath("/workspace/%E0%A4%A")).toBeNull();
	});
});

describe("rememberVisitedWorkspace", () => {
	it("重复走进同一视图保持原数组，超过上限丢掉最旧的", () => {
		const first = workspaceSurfaceForPath("/workspace/a/one");
		const second = workspaceSurfaceForPath("/workspace/b/two");
		const third = workspaceSurfaceForPath("/workspace/c/three");
		const fourth = workspaceSurfaceForPath("/workspace/d/four");
		if (!first || !second || !third || !fourth) throw new Error("fixture path");

		const withFirst = rememberVisitedWorkspace([], first);
		expect(rememberVisitedWorkspace(withFirst, first)).toBe(withFirst);
		expect(rememberVisitedWorkspace(withFirst, null)).toBe(withFirst);

		const stacked = rememberVisitedWorkspace(
			rememberVisitedWorkspace(rememberVisitedWorkspace(withFirst, second), third),
			fourth,
		);
		expect(stacked.map((item) => item.key)).toEqual(["b/two", "c/three", "d/four"]);
		expect(stacked).toHaveLength(MAX_RESIDENT_WORKSPACE_SURFACES);
	});
});
