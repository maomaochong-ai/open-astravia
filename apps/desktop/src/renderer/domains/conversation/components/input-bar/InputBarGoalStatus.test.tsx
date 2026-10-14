// @vitest-environment jsdom

import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputBarGoalStatus } from "./InputBarGoalStatus";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, number>) =>
			values ? `${key}:${Object.values(values).join(":")}` : key,
	}),
}));

afterEach(cleanup);

describe("InputBarGoalStatus", () => {
	it("keeps the footer summary compact and reveals details and pause on click", async () => {
		const user = userEvent.setup();
		const onPause = vi.fn(async () => true);
		render(
			<InputBarGoalStatus
				goal={{
					state: goal("active", "Checking the remaining tests"),
					busy: false,
					onPause,
					onResume: vi.fn(async () => true),
					onClear: vi.fn(async () => true),
				}}
			/>,
		);

		expect(screen.getByText("Ship goal mode")).toBeTruthy();
		expect(screen.queryByText("Checking the remaining tests")).toBeNull();
		expect(screen.queryByText("goalMode.summary.usage:1000:12:2")).toBeNull();

		await user.click(screen.getByRole("button", { name: "goalMode.summary.groupLabel" }));
		expect(screen.getByText("Checking the remaining tests")).toBeTruthy();
		expect(screen.getByText("goalMode.summary.usage:1000:12:2")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "goalMode.actions.pause" }));
		expect(onPause).toHaveBeenCalledOnce();
		expect(screen.queryByRole("button", { name: "goalMode.actions.resume" })).toBeNull();
	});

	it("offers resume and clear only after a blocked goal is expanded", async () => {
		const user = userEvent.setup();
		const onResume = vi.fn(async () => true);
		const onClear = vi.fn(async () => true);
		render(
			<InputBarGoalStatus
				goal={{
					state: goal("blocked", "No observable progress"),
					busy: false,
					onPause: vi.fn(async () => true),
					onResume,
					onClear,
				}}
			/>,
		);

		expect(screen.queryByRole("button", { name: "goalMode.actions.resume" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "goalMode.summary.groupLabel" }));
		await user.click(screen.getByRole("button", { name: "goalMode.actions.resume" }));
		await user.click(screen.getByRole("button", { name: "goalMode.actions.clear" }));
		expect(onResume).toHaveBeenCalledOnce();
		expect(onClear).toHaveBeenCalledOnce();
	});
});

function goal(status: "active" | "blocked", statusDetail: string) {
	return {
		goalId: "goal-1",
		objective: "Ship goal mode",
		status,
		statusDetail,
		tokensUsed: 1_000,
		timeUsedSeconds: 12,
		continuationCount: 2,
		createdAt: "t",
		updatedAt: "t",
	} as const;
}
