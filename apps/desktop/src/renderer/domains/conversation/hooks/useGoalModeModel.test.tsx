// @vitest-environment jsdom

import {
	type ActiveSession,
	activeInputDraftKeyAtom,
	activeSessionAtom,
	goalStateBySessionAtom,
	inputValueAtom,
} from "@shared/store/atoms";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CodingAgentGoalState } from "@vetta/coding-agent/session-extensions";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGoalModeModel } from "./useGoalModeModel";
import { useSessionStateEvents } from "./useSessionStateEvents";

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

	it.each(
		(["existing", "new", "resume"] as const).flatMap((entry) =>
			(["complete", "paused", null] as const).map((status) => ({ entry, status })),
		),
	)(
		"keeps the $status observation when the $entry goal command returns its earlier active snapshot",
		async ({ entry, status }) => {
			const runtimeId = entry === "new" ? "runtime-new" : "runtime-1";
			if (entry === "new") store.set(activeSessionAtom, null);
			if (entry === "resume") store.set(goalStateBySessionAtom, { [runtimeId]: goal("paused") });
			store.set(inputValueAtom, "Ship goal mode");
			const reply = deferred<ReturnType<typeof goal>>();
			startGoal.mockReturnValue(reply.promise);
			vi.mocked(window.vetta.session.resumeGoal).mockReturnValue(reply.promise);
			const startNewSessionGoal = async () => ({ sessionId: runtimeId, state: await reply.promise });
			const { result } = renderHook(() => ({
				model: useGoalModeModel(startNewSessionGoal),
				events: useSessionStateEvents({ activeSessionRef: { current: null }, syncDurableHistory: () => undefined }),
			}));
			if (entry !== "resume") act(() => result.current.model.onToggleCompose());
			let submission: Promise<boolean> | undefined;
			act(() => {
				submission = entry === "resume" ? result.current.model.resume() : result.current.model.submitDraft();
			});
			expect(result.current.model.busy).toBe(true);
			const observed = status ? goal(status) : null;
			act(() => {
				result.current.events(runtimeId, goalEvent(runtimeId, goal("active")));
				result.current.events(runtimeId, goalEvent(runtimeId, observed));
			});
			expect(store.get(goalStateBySessionAtom)[runtimeId] ?? null).toEqual(observed);
			await act(async () => {
				reply.resolve(goal("active"));
				expect(await submission).toBe(true);
			});

			expect(store.get(goalStateBySessionAtom)[runtimeId] ?? null).toEqual(observed);
			if (entry !== "new") {
				expect(result.current.model.state).toEqual(observed);
				expect(result.current.model.canCompose).toBe(status !== "paused");
			}
			expect(result.current.model.busy).toBe(false);
			if (entry !== "resume") expect(store.get(inputValueAtom)).toBe("");
		},
	);

	it("keeps observing a new goal after navigation unmounts the composer", async () => {
		store.set(activeSessionAtom, null);
		store.set(inputValueAtom, "Ship goal mode");
		const reply = deferred<ReturnType<typeof goal>>();
		const startNewSessionGoal = async () => ({ sessionId: "runtime-new", state: await reply.promise });
		const observer = renderHook(() =>
			useSessionStateEvents({ activeSessionRef: { current: null }, syncDurableHistory: () => undefined }),
		);
		const composer = renderHook(() => useGoalModeModel(startNewSessionGoal));
		act(() => composer.result.current.onToggleCompose());
		let submission: Promise<boolean> | undefined;
		act(() => {
			submission = composer.result.current.submitDraft();
		});
		composer.unmount();
		act(() => observer.result.current("runtime-new", goalEvent("runtime-new", goal("complete"))));
		await act(async () => {
			reply.resolve(goal("active"));
			expect(await submission).toBe(true);
		});

		expect(store.get(goalStateBySessionAtom)["runtime-new"]?.status).toBe("complete");
	});

	it("applies a command reply when only another session received an observation", async () => {
		store.set(inputValueAtom, "Ship goal mode");
		const reply = deferred<ReturnType<typeof goal>>();
		startGoal.mockReturnValue(reply.promise);
		const { result } = renderHook(() => ({
			model: useGoalModeModel(),
			events: useSessionStateEvents({ activeSessionRef: { current: null }, syncDurableHistory: () => undefined }),
		}));
		act(() => result.current.model.onToggleCompose());
		let submission: Promise<boolean> | undefined;
		act(() => {
			submission = result.current.model.submitDraft();
		});
		act(() => result.current.events("runtime-other", goalEvent("runtime-other", goal("complete"))));
		await act(async () => {
			reply.resolve(goal("active"));
			expect(await submission).toBe(true);
		});

		expect(result.current.model.state?.status).toBe("active");
		expect(store.get(goalStateBySessionAtom)["runtime-other"]?.status).toBe("complete");
	});

	it("supports pausing, resuming, and clearing when no observation arrives before the command reply", async () => {
		store.set(goalStateBySessionAtom, { "runtime-1": goal("active") });
		vi.mocked(window.vetta.session.pauseGoal).mockResolvedValue(goal("paused"));
		vi.mocked(window.vetta.session.resumeGoal).mockResolvedValue(goal("active"));
		vi.mocked(window.vetta.session.clearGoal).mockResolvedValue(null);
		const { result } = renderHook(() => useGoalModeModel());

		await act(async () => expect(await result.current.pause()).toBe(true));
		expect(result.current.state?.status).toBe("paused");
		await act(async () => expect(await result.current.resume()).toBe(true));
		expect(result.current.state?.status).toBe("active");
		await act(async () => expect(await result.current.clear()).toBe(true));
		expect(result.current.state).toBeNull();
		expect(result.current.canCompose).toBe(true);
	});

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

function goal(status: CodingAgentGoalState["status"]): CodingAgentGoalState {
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function goalEvent(runtimeId: string, payload: CodingAgentGoalState | null) {
	return {
		schemaVersion: 1 as const,
		channel: "runtime" as const,
		type: "session.extension" as const,
		sessionId: runtimeId,
		eventId: "goal-event",
		timestamp: 1,
		source: "runtime-core" as const,
		extensionId: "coding-agent.goal",
		event: "changed",
		payload,
	};
}
