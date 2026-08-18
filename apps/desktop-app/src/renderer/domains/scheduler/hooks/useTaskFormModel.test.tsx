// @vitest-environment jsdom

import { defaultConversationCwdAtom } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const schedulerMocks = vi.hoisted(() => ({
	createTask: vi.fn(),
	updateTask: vi.fn(),
}));

vi.mock("./useScheduledTasks", () => ({
	useScheduledTasks: () => schedulerMocks,
}));

import { useTaskFormModel } from "./useTaskFormModel";

describe("useTaskFormModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		schedulerMocks.createTask.mockResolvedValue(undefined);
		schedulerMocks.updateTask.mockResolvedValue(undefined);
	});

	it("preserves the paused state when editing an existing task", async () => {
		const onClose = vi.fn();
		const store = createStore();
		store.set(defaultConversationCwdAtom, "C:/default");
		const existing = {
			id: "paused-task",
			name: "Paused",
			prompt: "Run later",
			cron: "0 9 * * *",
			isOnce: false,
			enabled: false,
			cwd: "C:/workspace",
			createdAt: 1,
			updatedAt: 1,
			lastRunAt: null,
			lastRunStatus: null,
		} as const;
		const { result } = renderHook(() => useTaskFormModel({ open: true, task: existing, onClose }), {
			wrapper: wrapperFor(store),
		});
		await waitFor(() => expect(result.current.data.name).toBe("Paused"));

		act(() => result.current.onSubmit());

		await waitFor(() => expect(schedulerMocks.updateTask).toHaveBeenCalledOnce());
		expect(schedulerMocks.updateTask).toHaveBeenCalledWith(
			"paused-task",
			expect.objectContaining({ enabled: false }),
		);
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});

	it("waits for successful creation before closing the dialog", async () => {
		const pendingCreate = deferred<void>();
		schedulerMocks.createTask.mockReturnValue(pendingCreate.promise);
		const onClose = vi.fn();
		const store = createStore();
		store.set(defaultConversationCwdAtom, "C:/default");
		const initialDraft = { name: "Daily", prompt: "Summarize", cwd: "C:/workspace", cron: "0 9 * * *" };
		const { result } = renderHook(
			() =>
				useTaskFormModel({
					open: true,
					task: undefined,
					initialDraft,
					onClose,
				}),
			{ wrapper: wrapperFor(store) },
		);
		await waitFor(() => expect(result.current.canSubmit).toBe(true));

		act(() => result.current.onSubmit());
		expect(onClose).not.toHaveBeenCalled();
		await act(async () => pendingCreate.resolve());
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});
});

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
