// @vitest-environment jsdom
import {
	type ActiveSession,
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
} from "@shared/store/atoms";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
	}),
}));

const { PlanEntryCard } = await import("./PlanEntryCard.js");
const store = getDefaultStore();

describe("plan entry card in the message list", () => {
	beforeEach(() => {
		store.set(activeSessionAtom, { runtimeId: "runtime-1", cwd: "/work/project" } as ActiveSession);
		store.set(activityPanelOpenAtom, false);
		store.set(activityPanelTabByProjectAtom, new Map());
	});
	afterEach(cleanup);

	it("previews the first steps and opens the plan page of the activity panel", async () => {
		const plan = ["## Goal", "1. Add the gate", "2. Wire the UI", "3. Write tests", "4. Document", "5. Release"].join("\n");
		render(<PlanEntryCard plan={plan} />);

		expect(screen.getByText('planMode.entryCard.stepCount:{"count":5}')).toBeTruthy();
		expect(screen.getByText("Add the gate")).toBeTruthy();
		expect(screen.getByText("Write tests")).toBeTruthy();
		expect(screen.queryByText("Document")).toBeNull();
		expect(screen.getByText('planMode.entryCard.moreSteps:{"count":2}')).toBeTruthy();

		await userEvent.setup().click(screen.getByRole("button", { name: /planMode\.entryCard\.title/ }));
		expect(store.get(activityPanelOpenAtom)).toBe(true);
		expect(store.get(activityPanelTabByProjectAtom).get("/work/project")).toBe("plan");
	});

	it("still works as an entry when the plan has no numbered steps", () => {
		render(<PlanEntryCard plan="Refactor the module, then test it." />);
		expect(screen.getByRole("button", { name: /planMode\.entryCard\.open/ })).toBeTruthy();
		expect(screen.queryByText(/stepCount/)).toBeNull();
	});
});
