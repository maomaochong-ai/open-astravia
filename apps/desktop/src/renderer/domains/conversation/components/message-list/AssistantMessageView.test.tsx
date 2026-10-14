// @vitest-environment jsdom
import {
	AssistantMessage,
	type AssistantMessageFoldLabels,
} from "@vetta-org/theme-ui/chat";
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

	it("renders fold toggle with bold foreground text and without divider", () => {
		const { container } = render(
			<AssistantMessage.Fold
				state="complete"
				count={3}
				expanded={false}
				onToggle={vi.fn()}
				labels={{
					...labels,
					expandFold: () => "已完成",
				}}
			/>,
		);
		const button = screen.getByRole("button", { name: "已完成" });
		const labelSpan = button.querySelector("[data-export-toggle-label]");
		expect(button.className).toContain("text-foreground");
		expect(button.className).toContain("font-bold");
		expect(button.className).toContain("text-[14px]");
		expect(button.className).not.toContain("border-dashed");
		expect(labelSpan?.className).toContain("linear-gradient");
		expect(container.querySelector(".h-px")).toBeNull();

		// 展开后不要虚线
		const { container: expandedContainer } = render(
			<AssistantMessage.Fold
				state="complete"
				count={3}
				expanded
				onToggle={vi.fn()}
				labels={{
					...labels,
					collapseFold: () => "已完成",
				}}
			/>,
		);
		const expandedLabelSpan = expandedContainer.querySelector("[data-export-toggle-label]");
		expect(expandedLabelSpan?.className).toBe("");
	});

	it("renders process container with vertical line and completed indicator", () => {
		const { container } = render(
			<AssistantMessage.ProcessContainer completedLabel="完成">
				<div data-testid="step-item">Step 1</div>
			</AssistantMessage.ProcessContainer>,
		);
		expect(screen.getByTestId("step-item")).toBeTruthy();
		const endLabel = screen.getByText("完成");
		expect(endLabel).toBeTruthy();
		expect(endLabel.className).toContain("font-bold");
		expect(endLabel.className).not.toContain("linear-gradient");
		expect(container.querySelector(".bg-border\\/70")).toBeTruthy();
		expect(container.querySelector(".icon-\\[solar--check-circle-linear\\]")).toBeTruthy();
	});
});
