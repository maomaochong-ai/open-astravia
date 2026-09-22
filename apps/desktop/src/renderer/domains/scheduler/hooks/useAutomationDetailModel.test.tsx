// @vitest-environment jsdom

import { defaultConversationCwdAtom, type ScheduledTask } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const schedulerMocks = vi.hoisted(() => ({
	createTask: vi.fn(),
	updateTask: vi.fn(),
	toggleTask: vi.fn(),
	runNow: vi.fn(),
	deleteTask: vi.fn(),
}));

vi.mock("./useScheduledTasks", () => ({
	useScheduledTasks: () => schedulerMocks,
}));

import { useAutomationDetailModel } from "./useAutomationDetailModel";

const existing: ScheduledTask = {
	id: "paused-task",
	name: "Paused",
	prompt: "Run later",
	schedule: { kind: "daily", hour: 9, minute: 0 },
	runTarget: { mode: "same-session", projectCwd: "C:/workspace", sessionPath: "C:/sessions/bound.jsonl" },
	model: { key: "anthropic/opus" },
	enabled: false,
	createdAt: 1,
	updatedAt: 1,
	lastRunAt: null,
	lastRunStatus: null,
};

describe("useAutomationDetailModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		schedulerMocks.createTask.mockResolvedValue(undefined);
		schedulerMocks.updateTask.mockResolvedValue(undefined);
	});

	it("saves edits without touching the enabled switch and clears options the user turned off", async () => {
		const store = createStore();
		store.set(defaultConversationCwdAtom, "C:/default");
		const { result } = renderHook(
			() => useAutomationDetailModel({ pane: { kind: "task", task: existing }, onClose: vi.fn(), onCreated: vi.fn() }),
			{ wrapper: wrapperFor(store) },
		);
		expect(result.current.dirty).toBe(false);
		expect(result.current.canSubmit).toBe(false);

		act(() => result.current.onChange({ ...result.current.draft, name: "Renamed", model: null }));
		expect(result.current.dirty).toBe(true);
		act(() => result.current.onSubmit());

		await waitFor(() => expect(schedulerMocks.updateTask).toHaveBeenCalledOnce());
		const patch = schedulerMocks.updateTask.mock.calls[0]?.[1];
		expect(patch).toMatchObject({
			name: "Renamed",
			runTarget: { mode: "same-session", projectCwd: "C:/workspace", sessionPath: "C:/sessions/bound.jsonl" },
			model: null,
			notification: null,
		});
		expect(patch).not.toHaveProperty("enabled");
		await waitFor(() => expect(result.current.dirty).toBe(false));
	});

	it("creates from the prefilled draft, hands the new task back, and surfaces host rejections", async () => {
		const store = createStore();
		store.set(defaultConversationCwdAtom, "C:/default");
		const onCreated = vi.fn();
		const created = { ...existing, id: "created" };
		schedulerMocks.createTask.mockRejectedValueOnce(
			new Error("Error invoking remote method 'vetta:scheduler:create-task': SchedulerServiceError: 目标项目不存在。"),
		);
		schedulerMocks.createTask.mockResolvedValueOnce(created);
		const { result } = renderHook(
			() =>
				useAutomationDetailModel({
					pane: { kind: "create", draft: { name: "Daily", prompt: "Summarize" }, key: 1 },
					onClose: vi.fn(),
					onCreated,
				}),
			{ wrapper: wrapperFor(store) },
		);
		await waitFor(() => expect(result.current.canSubmit).toBe(true));

		act(() => result.current.onSubmit());
		await waitFor(() => expect(result.current.error).toBe("目标项目不存在。"));
		expect(onCreated).not.toHaveBeenCalled();

		act(() => result.current.onSubmit());
		await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
		expect(schedulerMocks.createTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				name: "Daily",
				runTarget: { mode: "new-session", projectCwd: "C:/default" },
				enabled: true,
			}),
		);
	});
});

function wrapperFor(store: ReturnType<typeof createStore>) {
	return function TestProvider({ children }: { children: ReactNode }): JSX.Element {
		return <Provider store={store}>{children}</Provider>;
	};
}
