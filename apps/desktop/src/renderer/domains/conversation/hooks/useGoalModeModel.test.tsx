// @vitest-environment jsdom

import {
	type ActiveSession,
	activeInputDraftKeyAtom,
	activeSessionAtom,
	goalStateBySessionAtom,
	inputValueAtom,
} from "@shared/store/atoms";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGoalModeModel } from "./useGoalModeModel";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@shared/store/toast-atoms", () => ({ showToast }));

const store = getDefaultStore();
const startGoal = vi.fn();

describe("useGoalModeModel composer flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		store.set(activeSessionAtom, { runtimeId: "runtime-1", sessionPath: "session.jsonl" } as ActiveSession);
		store.set(activeInputDraftKeyAtom, "session.jsonl");
		store.set(goalStateBySessionAtom, {});
		store.set(inputValueAtom, "");
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				session: {
					startGoal,
					pauseGoal: vi.fn(),
					resumeGoal: vi.fn(),
					clearGoal: vi.fn(),
				},
			},
		});
	});

	afterEach(cleanup);

	it("uses the main composer draft as the goal and consumes it only after success", async () => {
		startGoal.mockResolvedValue(goal("active"));
		store.set(inputValueAtom, "  Ship goal mode  ");
		const { result } = renderHook(() => useGoalModeModel());

		act(() => result.current.onToggleCompose());
		expect(result.current.composing).toBe(true);
		await act(async () => expect(await result.current.submitDraft()).toBe(true));

		expect(startGoal).toHaveBeenCalledWith("runtime-1", "Ship goal mode");
		expect(store.get(inputValueAtom)).toBe("");
		expect(store.get(goalStateBySessionAtom)["runtime-1"]?.status).toBe("active");
		expect(result.current.composing).toBe(false);
	});

	it("keeps the draft and goal intent when starting fails", async () => {
		startGoal.mockRejectedValue(new Error("unavailable"));
		store.set(inputValueAtom, "Ship goal mode");
		const { result } = renderHook(() => useGoalModeModel());

		act(() => result.current.onToggleCompose());
		await act(async () => expect(await result.current.submitDraft()).toBe(false));

		expect(store.get(inputValueAtom)).toBe("Ship goal mode");
		expect(result.current.composing).toBe(true);
		expect(showToast).toHaveBeenCalledWith({ variant: "error", message: "goalMode.operationFailed" });
	});

	it("does not erase text entered while a new-session goal is materializing", async () => {
		store.set(activeSessionAtom, null);
		store.set(inputValueAtom, "First goal");
		let resolveStart: ((value: { sessionId: string; state: ReturnType<typeof goal> }) => void) | undefined;
		const startNewSessionGoal = vi.fn(
			() =>
				new Promise<{ sessionId: string; state: ReturnType<typeof goal> }>((resolve) => {
					resolveStart = resolve;
				}),
		);
		const { result } = renderHook(() => useGoalModeModel(startNewSessionGoal));

		act(() => result.current.onToggleCompose());
		let submission: Promise<boolean> | undefined;
		act(() => {
			submission = result.current.submitDraft();
		});
		await waitFor(() => expect(startNewSessionGoal).toHaveBeenCalledWith("First goal"));
		store.set(inputValueAtom, "Follow-up typed while opening");
		await act(async () => {
			resolveStart?.({ sessionId: "runtime-new", state: goal("active") });
			expect(await submission).toBe(true);
		});

		expect(store.get(inputValueAtom)).toBe("Follow-up typed while opening");
		expect(store.get(goalStateBySessionAtom)["runtime-new"]?.status).toBe("active");
	});
});

function goal(status: "active") {
	return {
		goalId: "goal-1",
		objective: "Ship goal mode",
		status,
		tokensUsed: 1_000,
		timeUsedSeconds: 2,
		continuationCount: 1,
		createdAt: "t",
		updatedAt: "t",
	};
}
