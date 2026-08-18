// @vitest-environment jsdom
/**
 * 选择状态的接线：默认值跟随入口、用户选择只覆盖页面本地上下文、换入口后重新推导。
 */
import { defaultConversationCwdAtom, type Project, projectsAtom } from "@shared/store/atoms";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { JSX, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useNewSessionProjectSelection } from "./useNewSessionProjectSelection";

const DEFAULT_CWD = "/home/u/conversation";

const PROJECTS = [
	{ cwd: DEFAULT_CWD, name: "对话", sessionCount: 0, type: "normal", isDefault: true },
	{ cwd: "/w/alpha", name: "Alpha", sessionCount: 0, type: "normal" },
	{ cwd: "/w/batch", name: "批量", sessionCount: 0, type: "batch" },
] as Project[];

function renderSelection(routeCwd: string) {
	const store = createStore();
	store.set(projectsAtom, PROJECTS);
	store.set(defaultConversationCwdAtom, DEFAULT_CWD);
	const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
		<Provider store={store}>{children}</Provider>
	);
	return renderHook(({ cwd }: { cwd: string }) => useNewSessionProjectSelection(cwd), {
		initialProps: { cwd: routeCwd },
		wrapper,
	});
}

describe("useNewSessionProjectSelection", () => {
	it("从默认「对话」进入：未选中，上下文仍是默认项目", () => {
		const { result } = renderSelection(DEFAULT_CWD);
		expect(result.current.selection).toBeNull();
		expect(result.current.contextCwd).toBe(DEFAULT_CWD);
	});

	it("从项目进入：默认选中该项目，可选列表里没有默认「对话」与批量项目", () => {
		const { result } = renderSelection("/w/alpha");
		expect(result.current.selection).toEqual({ kind: "project", cwd: "/w/alpha", name: "Alpha" });
		expect(result.current.options).toEqual([{ cwd: "/w/alpha", name: "Alpha" }]);
	});

	it("选「不指定项目」后上下文回到默认「对话」，路由不参与", () => {
		const { result } = renderSelection("/w/alpha");
		act(() => result.current.selectProject(null));
		expect(result.current.selection).toBeNull();
		expect(result.current.contextCwd).toBe(DEFAULT_CWD);
	});

	it("待创建项目不改上下文：目标目录此刻还不存在", () => {
		const { result } = renderSelection(DEFAULT_CWD);
		act(() => result.current.selectPendingProject("新项目"));
		expect(result.current.selection).toEqual({ kind: "pending-create", name: "新项目" });
		expect(result.current.contextCwd).toBe(DEFAULT_CWD);

		act(() => result.current.applyCreatedProject("/w/created", "新项目"));
		expect(result.current.contextCwd).toBe("/w/created");
	});

	it("换一个新会话入口后本地覆盖作废，重新按入口推导", () => {
		const { result, rerender } = renderSelection(DEFAULT_CWD);
		act(() => result.current.selectPendingProject("新项目"));
		expect(result.current.selection).toEqual({ kind: "pending-create", name: "新项目" });

		rerender({ cwd: "/w/alpha" });
		expect(result.current.selection).toEqual({ kind: "project", cwd: "/w/alpha", name: "Alpha" });
	});

	it("takenNames 覆盖全部项目名，重名判断不漏掉默认与批量项目", () => {
		const { result } = renderSelection(DEFAULT_CWD);
		expect(result.current.takenNames).toEqual(["对话", "Alpha", "批量"]);
	});
});
