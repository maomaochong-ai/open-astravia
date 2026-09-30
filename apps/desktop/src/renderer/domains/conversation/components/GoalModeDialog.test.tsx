// @vitest-environment jsdom

import {
	type ActiveSession,
	activeSessionAtom,
	goalDialogOpenAtom,
	goalStateBySessionAtom,
} from "@shared/store/atoms";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalModeDialog } from "./GoalModeDialog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const store = getDefaultStore();
const startGoal = vi.fn();
const resumeGoal = vi.fn();

describe("GoalModeDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		store.set(activeSessionAtom, { runtimeId: "runtime-1", sessionPath: "session.jsonl" } as ActiveSession);
		store.set(goalStateBySessionAtom, {});
		store.set(goalDialogOpenAtom, true);
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { session: { startGoal, resumeGoal, pauseGoal: vi.fn(), clearGoal: vi.fn() } },
		});
	});

	afterEach(cleanup);

	it("starts a goal without asking the user for a token budget", async () => {
		startGoal.mockResolvedValue(goal("active"));
		const user = userEvent.setup();
		render(<GoalModeDialog />);

		await user.type(screen.getByRole("textbox", { name: "goalMode.dialog.objectiveLabel" }), "Ship goal mode");
		expect(screen.queryByRole("spinbutton")).toBeNull();
		await user.click(screen.getByRole("button", { name: "goalMode.dialog.start" }));

		await waitFor(() => expect(startGoal).toHaveBeenCalledWith("runtime-1", "Ship goal mode"));
		expect(store.get(goalStateBySessionAtom)["runtime-1"]?.status).toBe("active");
	});

	it("restores a paused goal without replacing its objective", async () => {
		store.set(goalStateBySessionAtom, { "runtime-1": goal("paused") });
		resumeGoal.mockResolvedValue(goal("active"));
		const user = userEvent.setup();
		render(<GoalModeDialog />);

		expect(screen.getByText("Ship goal mode")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "goalMode.dialog.resume" }));

		await waitFor(() => expect(resumeGoal).toHaveBeenCalledWith("runtime-1", "goal-1"));
		expect(store.get(goalStateBySessionAtom)["runtime-1"]?.status).toBe("active");
	});
});

function goal(status: "active" | "paused") {
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
