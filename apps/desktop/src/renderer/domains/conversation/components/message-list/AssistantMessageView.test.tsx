// @vitest-environment jsdom
import {
	AssistantMessage,
	type AssistantMessageFoldLabels,
} from "@vetta/theme-ui/chat";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const labels: AssistantMessageFoldLabels = {
	streamingFold: (elapsed) => `streaming ${elapsed}`,
	waitingFold: (elapsed) => `waited ${elapsed}`,
	expandFold: (count) => `expand ${count}`,
	collapseFold: (count) => `collapse ${count}`,
};

describe("AssistantMessage primitives", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("keeps the waiting fold as an independently mountable capability", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(66_000));
		render(
			<AssistantMessage.Fold
				state="streaming"
				count={0}
				expanded
				startedAt={1_000}
				waitingForFirstActivity
				onToggle={vi.fn()}
				labels={labels}
			/>,
		);
		expect(screen.getByText("waited 65")).toBeTruthy();
	});

	it("exposes the complete fold toggle without owning the message layout", async () => {
		const onToggle = vi.fn();
		render(
			<AssistantMessage.Fold
				state="complete"
				count={3}
				expanded={false}
				onToggle={onToggle}
				labels={labels}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "expand 3" }));
		expect(onToggle).toHaveBeenCalledOnce();
	});
});
