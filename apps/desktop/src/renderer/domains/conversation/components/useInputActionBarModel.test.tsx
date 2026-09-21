// @vitest-environment jsdom
import {
	type ActiveSession,
	activeSessionAtom,
	currentScenarioAtom,
	draftPlanModeAtom,
	planModeStateBySessionAtom,
} from "@shared/store/atoms";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@shared/hooks/useShortcuts", () => ({ useEffectiveShortcut: () => "shift+tab" }));
vi.mock("../../plugins/runtime/plugin-i18n", () => ({ usePluginTextResolver: () => (_id: string, text: string) => text }));

const { BUILTIN_PLAN_MODE_ACTION_ID, useInputActionBarModel } = await import("./useInputActionBarModel.js");
const store = getDefaultStore();

describe("plan mode as an input action", () => {
	const setPermissionMode = vi.fn(async (_id: string, permissionMode: "default" | "plan") => ({ permissionMode }));

	beforeEach(() => {
		vi.clearAllMocks();
		store.set(activeSessionAtom, { runtimeId: "runtime-1", sessionPath: "" } as ActiveSession);
		store.set(currentScenarioAtom, "project");
		store.set(draftPlanModeAtom, false);
		store.set(planModeStateBySessionAtom, {});
		Object.defineProperty(window, "vetta", { configurable: true, value: { session: { setPermissionMode } } });
	});
	afterEach(cleanup);

	const planAction = (model: ReturnType<typeof useInputActionBarModel>) =>
		model.builtins.find(({ id }) => id === BUILTIN_PLAN_MODE_ACTION_ID);

	it("is listed next to the other input actions and one toggle both enters and leaves plan mode", async () => {
		const { result } = renderHook(() => useInputActionBarModel());
		expect(result.current.visible).toBe(true);
		expect(planAction(result.current)).toMatchObject({ label: "inputActionBar.planMode.label", active: false });

		// 列表里点一下开启；激活后的胶囊关闭按钮调用的是同一个 onToggle。
		act(() => planAction(result.current)?.onToggle());
		await waitFor(() => expect(planAction(result.current)?.active).toBe(true));
		expect(setPermissionMode).toHaveBeenLastCalledWith("runtime-1", "plan");

		act(() => planAction(result.current)?.onToggle());
		await waitFor(() => expect(planAction(result.current)?.active).toBe(false));
		expect(setPermissionMode).toHaveBeenLastCalledWith("runtime-1", "default");
	});

	it("is not offered where nobody can approve a plan", () => {
		store.set(currentScenarioAtom, "batch");
		const { result } = renderHook(() => useInputActionBarModel());
		expect(planAction(result.current)).toBeUndefined();
	});
});
