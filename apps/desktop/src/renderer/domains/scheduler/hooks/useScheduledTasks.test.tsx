// @vitest-environment jsdom

import type { DesktopApi } from "@preload/api";
import { scheduledTasksAtom, type ScheduledTask } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScheduledTasks } from "./useScheduledTasks";

describe("useScheduledTasks", () => {
	let emitTaskEvent: (event: { type: "tasks.changed" }) => void;
	let unsubscribe: ReturnType<typeof vi.fn>;
	let scheduler: DesktopApi["scheduler"];

	beforeEach(() => {
		unsubscribe = vi.fn();
		scheduler = {
			getTasks: vi.fn(async () => []),
			createTask: vi.fn(),
			updateTask: vi.fn(async () => undefined),
			deleteTask: vi.fn(async () => undefined),
			toggleTask: vi.fn(async () => undefined),
			disableTask: vi.fn(async () => undefined),
			getRecords: vi.fn(async () => []),
			getRunningTaskIds: vi.fn(async () => []),
			getScheduledSessionPaths: vi.fn(async () => []),
			deleteRecordsBySession: vi.fn(async () => []),
			runTaskNow: vi.fn(async () => undefined),
			abortTask: vi.fn(async () => undefined),
			onTaskEvent: vi.fn((handler) => {
				emitTaskEvent = handler;
				return unsubscribe;
			}),
		};
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { scheduler } as unknown as DesktopApi,
		});
	});

	it("refreshes task state from the host event and detaches the listener on unmount", async () => {
		const refreshed = task("refreshed");
		vi.mocked(scheduler.getTasks).mockResolvedValue([refreshed]);
		const store = createStore();
		const { result, unmount } = renderHook(() => useScheduledTasks(), { wrapper: wrapperFor(store) });

		act(() => emitTaskEvent({ type: "tasks.changed" }));

		await waitFor(() => expect(result.current.tasks).toEqual([refreshed]));
		expect(scheduler.getTasks).toHaveBeenCalledOnce();
		unmount();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("does not drop a task added while an update IPC call is in flight", async () => {
		const first = task("first");
		const added = task("added");
		const pendingUpdate = deferred<void>();
		vi.mocked(scheduler.updateTask).mockReturnValue(pendingUpdate.promise);
		const store = createStore();
		store.set(scheduledTasksAtom, [first]);
		const { result } = renderHook(() => useScheduledTasks(), { wrapper: wrapperFor(store) });
		let updatePromise: Promise<void> | undefined;

		act(() => {
			updatePromise = result.current.updateTask(first.id, { name: "Updated" });
		});
		await waitFor(() => expect(scheduler.updateTask).toHaveBeenCalledOnce());
		act(() => store.set(scheduledTasksAtom, [first, added]));
		await act(async () => {
			pendingUpdate.resolve();
			await updatePromise;
		});

		expect(store.get(scheduledTasksAtom).map(({ id, name }) => ({ id, name }))).toEqual([
			{ id: "first", name: "Updated" },
			{ id: "added", name: "Task added" },
		]);
	});

	it("deletes from the latest task list after the host call completes", async () => {
		const removed = task("removed");
		const retained = task("retained");
		const added = task("added");
		const pendingDelete = deferred<void>();
		vi.mocked(scheduler.deleteTask).mockReturnValue(pendingDelete.promise);
		const store = createStore();
		store.set(scheduledTasksAtom, [removed, retained]);
		const { result } = renderHook(() => useScheduledTasks(), { wrapper: wrapperFor(store) });
		let deletePromise: Promise<void> | undefined;

		act(() => {
			deletePromise = result.current.deleteTask(removed.id);
		});
		await waitFor(() => expect(scheduler.deleteTask).toHaveBeenCalledOnce());
		act(() => store.set(scheduledTasksAtom, [removed, retained, added]));
		await act(async () => {
			pendingDelete.resolve();
			await deletePromise;
		});

		expect(store.get(scheduledTasksAtom).map((item) => item.id)).toEqual(["retained", "added"]);
	});
});

function task(id: string): ScheduledTask {
	return {
		id,
		name: `Task ${id}`,
		prompt: "Run it",
		cron: "0 9 * * *",
		isOnce: false,
		enabled: true,
		cwd: "C:/workspace",
		createdAt: 1,
		updatedAt: 1,
		lastRunAt: null,
		lastRunStatus: null,
	};
}

function wrapperFor(store: ReturnType<typeof createStore>) {
	return function TestProvider({ children }: { children: ReactNode }): JSX.Element {
		return <Provider store={store}>{children}</Provider>;
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve: (value) => resolve(value as T) };
}
