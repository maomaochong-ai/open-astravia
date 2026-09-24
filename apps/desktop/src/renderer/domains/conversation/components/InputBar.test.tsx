// @vitest-environment jsdom
import type { ReactNode } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputBarModel } from "./input-bar/types";
import { InputBar } from "./InputBar";

const captured = vi.hoisted(() => ({ model: vi.fn() }));

vi.mock("@vetta-org/theme-sdk", () => ({ useThemeComponent: (_slot: string, component: unknown) => component }));
vi.mock("./input-bar/InputBarView", () => ({
	InputBarView: ({ model, children }: { model: InputBarModel; children: ReactNode }) => {
		captured.model(model);
		return <div data-testid="input-bar-view">{children}</div>;
	},
}));

afterEach(() => {
	cleanup();
	captured.model.mockReset();
});

describe("InputBar presentation", () => {
	it("renders the existing themed view from an explicit model", () => {
		const model = { marker: "team" } as unknown as InputBarModel;
		const onSelect = vi.fn();
		render(<InputBar model={model}><button type="button" onClick={onSelect}>Team models</button></InputBar>);
		fireEvent.click(screen.getByRole("button", { name: "Team models" }));
		expect(onSelect).toHaveBeenCalledOnce();

		expect(screen.getByTestId("input-bar-view")).toBeTruthy();
		expect(captured.model).toHaveBeenCalledWith(model);
	});
});
