// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INPUT_BAR_FOOTER_EXIT_MS } from "./input-bar-footer-state";
import { InputBarFooter } from "./InputBarFooter";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("InputBarFooter compound items", () => {
	it("keeps a removed item's last content until its exit transition completes", () => {
		vi.useFakeTimers();
		const view = render(
			<InputBarFooter.Root>
				<InputBarFooter.Item>
					<span>Todo status</span>
				</InputBarFooter.Item>
				<InputBarFooter.Item>{null}</InputBarFooter.Item>
			</InputBarFooter.Root>,
		);

		view.rerender(
			<InputBarFooter.Root>
				<InputBarFooter.Item>{null}</InputBarFooter.Item>
				<InputBarFooter.Item>{null}</InputBarFooter.Item>
			</InputBarFooter.Root>,
		);

		expect(screen.getByText("Todo status")).toBeTruthy();
		expect(screen.getByText("Todo status").closest("[aria-hidden='true']")).toBeTruthy();

		act(() => vi.advanceTimersByTime(INPUT_BAR_FOOTER_EXIT_MS));

		expect(screen.queryByText("Todo status")).toBeNull();
	});
});
