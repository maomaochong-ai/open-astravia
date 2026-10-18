// @vitest-environment jsdom
import { todoItemsBySessionAtom } from "@shared/store/atoms";
import type { TodoItem } from "@shared/store/todo-atoms";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityPanelContextProvider } from "../registry/context";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { todoTabDefinition } = await import("./todo-tab.js");
const store = getDefaultStore();

const CLEAR_TODOS = vi.fn(async (_sessionId: string) => true);

function wrapperFor(runtimeIds: readonly string[]) {
	return ({ children }: { children: ReactNode }) => (
		<ActivityPanelContextProvider
			value={{ workspace: { id: "workspace", cwd: null, runtimeIds: [...runtimeIds] }, knowledgeHistory: false }}
		>
			{children}
		</ActivityPanelContextProvider>
	);
}

function todoMap(entries: Record<string, TodoItem[]>): Map<string, TodoItem[]> {
	return new Map(Object.entries(entries));
}

describe("activity panel todo tab", () => {
	beforeEach(() => {
		CLEAR_TODOS.mockClear();
		window.astravia = { session: { clearTodos: CLEAR_TODOS } } as unknown as typeof window.astravia;
	});
	afterEach(() => {
		cleanup();
		store.set(todoItemsBySessionAtom, new Map());
	});

	it("只在有清单时占用一个 tab", () => {
		const meta = renderHook(() => todoTabDefinition.useMeta(), { wrapper: wrapperFor(["runtime-1"]) });
		expect(meta.result.current).toBeNull();

		store.set(
			todoItemsBySessionAtom,
			todoMap({ "runtime-1": [{ id: 1, content: "Ship it", status: "pending" }] }),
		);
		meta.rerender();
		expect(meta.result.current).toMatchObject({ label: "activityPanel.tabs.todo", badge: 1 });
	});

	it("展示当前清单，并可以从面板直接清空", async () => {
		store.set(
			todoItemsBySessionAtom,
			todoMap({
				"runtime-1": [
					{ id: 1, content: "Write the fix", status: "done" },
					{ id: 2, content: "Verify it", status: "pending" },
				],
			}),
		);
		const Tab = todoTabDefinition.component;
		render(
			<Suspense fallback={null}>
				<Tab />
			</Suspense>,
			{ wrapper: wrapperFor(["runtime-1"]) },
		);

		expect(await screen.findByText("Write the fix")).toBeTruthy();
		expect(screen.getByText("Verify it")).toBeTruthy();
		expect(screen.getByText("activityPanel.todo.progress")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "activityPanel.todo.clear" }));

		expect(CLEAR_TODOS).toHaveBeenCalledTimes(1);
		expect(CLEAR_TODOS).toHaveBeenCalledWith("runtime-1");
	});

	it("只清空真正持有清单的 Runtime，不误伤同一工作区的其它会话", async () => {
		store.set(
			todoItemsBySessionAtom,
			todoMap({ "runtime-1": [{ id: 1, content: "Only here", status: "pending" }] }),
		);
		const Tab = todoTabDefinition.component;
		render(
			<Suspense fallback={null}>
				<Tab />
			</Suspense>,
			{ wrapper: wrapperFor(["runtime-1", "runtime-2"]) },
		);

		fireEvent.click(await screen.findByRole("button", { name: "activityPanel.todo.clear" }));

		expect(CLEAR_TODOS.mock.calls).toEqual([["runtime-1"]]);
	});
});
