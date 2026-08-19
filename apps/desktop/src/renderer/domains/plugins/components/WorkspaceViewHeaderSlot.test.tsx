// @vitest-environment jsdom
import { pluginWorkspaceViewHeadersAtom, workspaceViewHeaderKey } from "@shared/store/atoms";
import { renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const matches = vi.hoisted(() => ({ current: [] as Array<{ params: Record<string, string> }> }));

vi.mock("@tanstack/react-router", () => ({
	useMatches: () => matches.current,
}));

const { useActiveWorkspaceViewHeader } = await import("./WorkspaceViewHeaderSlot");

function onRoute(params: Record<string, string>): void {
	matches.current = [{ params: {} }, { params }];
}

describe("useActiveWorkspaceViewHeader", () => {
	beforeEach(() => {
		getDefaultStore().set(pluginWorkspaceViewHeadersAtom, {
			[workspaceViewHeaderKey("demo", "gallery")]: {
				pluginId: "demo",
				viewId: "gallery",
				hideTitle: true,
				immersive: true,
				title: "Design",
				left: "left-node",
			},
		});
	});

	it("applies the takeover on the owning view's route", () => {
		onRoute({ pluginId: "demo", viewId: "gallery" });
		const { result } = renderHook(() => useActiveWorkspaceViewHeader());
		expect(result.current?.hideTitle).toBe(true);
		expect(result.current?.immersive).toBe(true);
		expect(result.current?.title).toBe("Design");
		expect(result.current?.left).toBeTruthy();
		// 插件没给 right，宿主自己的右侧插槽不能被一个空节点顶掉。
		expect(result.current?.right).toBeUndefined();
	});

	it("ignores another view of the same plugin", () => {
		onRoute({ pluginId: "demo", viewId: "other" });
		const { result } = renderHook(() => useActiveWorkspaceViewHeader());
		expect(result.current).toBeUndefined();
	});

	it("ignores routes that are not workspace views", () => {
		onRoute({ themeId: "demo", pageId: "gallery" });
		const { result } = renderHook(() => useActiveWorkspaceViewHeader());
		expect(result.current).toBeUndefined();
	});
});
