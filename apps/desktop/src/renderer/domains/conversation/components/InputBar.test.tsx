// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputBarModel } from "./input-bar/types";
import { InputBar } from "./InputBar";

const captured = vi.hoisted(() => ({ model: vi.fn() }));

vi.mock("@vetta/theme-sdk", () => ({ useThemeComponent: (_slot: string, component: unknown) => component }));
vi.mock("./input-bar/InputBarView", () => ({
	InputBarView: ({ model }: { model: InputBarModel }) => {
		captured.model(model);
		return <div data-testid="input-bar-view" />;
	},
}));

afterEach(() => {
	cleanup();
	captured.model.mockReset();
});

describe("InputBar presentation", () => {
	it("renders the existing themed view from an explicit model", () => {
		const model = { marker: "team" } as unknown as InputBarModel;
		render(<InputBar model={model} />);

		expect(screen.getByTestId("input-bar-view")).toBeTruthy();
		expect(captured.model).toHaveBeenCalledWith(model);
	});
});
