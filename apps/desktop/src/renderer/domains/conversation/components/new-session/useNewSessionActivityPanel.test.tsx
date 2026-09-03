// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { activityPanelOpenAtom } from "@shared/store/atoms";
import { createStore, Provider } from "jotai";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useNewSessionActivityPanel } from "./useNewSessionActivityPanel";

function renderPanel(initialCwd: string | null, open: boolean) {
	const store = createStore();
	store.set(activityPanelOpenAtom, open);
	const wrapper = ({ children }: { children: ReactNode }) => createElement(Provider, { store }, children);
	const view = renderHook(({ cwd }: { cwd: string | null }) => useNewSessionActivityPanel(cwd), {
		initialProps: { cwd: initialCwd },
		wrapper,
	});
	return { ...view, store };
}

describe("useNewSessionActivityPanel", () => {
	it("「对话」scope 进入时收起面板，忽略记忆里的展开态", () => {
		const { result } = renderPanel(null, true);

		expect(result.current.open).toBe(false);
	});

	it("选中项目时保留记忆里的展开态", () => {
		const { result } = renderPanel("/w/demo", true);

		expect(result.current.open).toBe(true);
	});

	it("从项目切回「对话」时收起面板", () => {
		const { result, rerender } = renderPanel("/w/demo", true);

		rerender({ cwd: null });

		expect(result.current.open).toBe(false);
	});

	it("停留在「对话」scope 时不压掉用户的手动展开", () => {
		const { result, rerender } = renderPanel(null, true);

		act(() => result.current.toggle());
		expect(result.current.open).toBe(true);

		rerender({ cwd: null });

		expect(result.current.open).toBe(true);
	});
});
