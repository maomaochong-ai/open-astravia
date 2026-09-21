// @vitest-environment jsdom
import {
	type ActiveSession,
	activeSessionAtom,
	draftPlanModeAtom,
	planModeStateBySessionAtom,
} from "@shared/store/atoms";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@shared/hooks/useShortcuts", () => ({ useEffectiveShortcut: () => "shift+tab" }));

const { usePlanModeModel } = await import("./usePlanModeModel.js");
const { applyDraftPlanMode } = await import("../services/plan-mode-draft.js");

const store = getDefaultStore();
const session = { runtimeId: "runtime-1" } as ActiveSession;

describe("plan mode toggle", () => {
	const setPermissionMode = vi.fn(async (_runtimeId: string, permissionMode: "default" | "plan") => ({
		permissionMode,
	}));

	beforeEach(() => {
		vi.clearAllMocks();
		store.set(activeSessionAtom, null);
		store.set(draftPlanModeAtom, false);
		store.set(planModeStateBySessionAtom, {});
		Object.defineProperty(window, "vetta", { configurable: true, value: { session: { setPermissionMode } } });
	});
	afterEach(cleanup);

	it("remembers the choice on the new-session page and applies it before the first message", async () => {
		const { result } = renderHook(() => usePlanModeModel());
		expect(result.current.active).toBe(false);

		act(() => result.current.onToggle());
		expect(result.current.active).toBe(true);
		expect(setPermissionMode).not.toHaveBeenCalled();

		await act(() => applyDraftPlanMode("runtime-1"));
		expect(setPermissionMode).toHaveBeenCalledWith("runtime-1", "plan");
		expect(store.get(draftPlanModeAtom)).toBe(false);

		// 会话创建后，开关读的是该会话自己的状态，而不是已清空的草稿。
		act(() => store.set(activeSessionAtom, session));
		expect(result.current.active).toBe(true);
	});

	it("keeps the draft and fails the send when the session cannot enter plan mode", async () => {
		store.set(draftPlanModeAtom, true);
		setPermissionMode.mockRejectedValueOnce(new Error("Plan mode is unavailable in the batch scenario"));
		await expect(applyDraftPlanMode("runtime-1")).rejects.toThrow("unavailable");
		expect(store.get(draftPlanModeAtom)).toBe(true);
	});

	it("switches the running session on and off", async () => {
		store.set(activeSessionAtom, session);
		const { result } = renderHook(() => usePlanModeModel());

		act(() => result.current.onToggle());
		await waitFor(() => expect(result.current.active).toBe(true));
		expect(setPermissionMode).toHaveBeenLastCalledWith("runtime-1", "plan");

		act(() => result.current.onToggle());
		await waitFor(() => expect(result.current.active).toBe(false));
		expect(setPermissionMode).toHaveBeenLastCalledWith("runtime-1", "default");
	});

	it("follows the mode the runtime reports, such as an approval turning plan mode off", () => {
		store.set(activeSessionAtom, session);
		store.set(planModeStateBySessionAtom, { "runtime-1": { permissionMode: "plan" } });
		const { result } = renderHook(() => usePlanModeModel());
		expect(result.current.active).toBe(true);

		act(() => store.set(planModeStateBySessionAtom, { "runtime-1": { permissionMode: "default" } }));
		expect(result.current.active).toBe(false);
	});

	it("toggles from the configured shortcut and ignores other keys", () => {
		const { result } = renderHook(() => usePlanModeModel());
		const other = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
		expect(result.current.handleKeyDown(other)).toBe(false);
		expect(other.defaultPrevented).toBe(false);

		const shortcut = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
		let handled = false;
		act(() => {
			handled = result.current.handleKeyDown(shortcut);
		});
		expect(handled).toBe(true);
		expect(shortcut.defaultPrevented).toBe(true);
		expect(result.current.active).toBe(true);
	});
});
