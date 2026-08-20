// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BackgroundTasksTabPanelView, WorkflowTabPanelView } from "@vetta/theme-ui/activity";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("Subagent activity views", () => {
	it("renders concise objective, live progress, usage, and classified errors", () => {
		const html = renderToStaticMarkup(
			<BackgroundTasksTabPanelView
				items={[
					{
						kind: "subagent",
						id: "child-1",
						agentType: "general",
						taskName: "api_contract",
						path: "/root/api_contract",
						status: "failed",
						taskPreview: "Verify the public API contract.",
						errorLabel: "Connection interrupted",
						errorDetail: "The model endpoint timed out.",
						progressLabel: "2/3",
						usageLabel: "1.3K tokens · $0.004",
						statusIcon: "icon-[solar--danger-circle-linear]",
						statusLabel: "Failed",
						statusClassName: "text-destructive",
						durationLabel: "12s",
					},
				]}
				emptyLabel="No tasks"
				clearFinishedLabel={null}
				onClearFinished={vi.fn()}
				stopLabel="Stop"
				onStop={vi.fn()}
			/>,
		);

		expect(html).toContain("Verify the public API contract.");
		expect(html).toContain("1.3K tokens · $0.004");
		expect(html).toContain("Connection interrupted");
		expect(html).toContain("break-words");
	});

	it("renders the selected workflow hierarchy with an icon-first stop action", () => {
		const html = renderToStaticMarkup(
			<WorkflowTabPanelView
				items={[
					{
						id: "workflow-1",
						name: "API contract",
						progressLabel: "1/2",
						statusLabel: "Running",
						statusIcon: "icon-[solar--refresh-linear] animate-spin",
						statusClassName: "text-emerald-400",
						objective: "Complete and verify the API contract.",
						usageLabel: "800 tokens · $0.01",
						selected: true,
						active: true,
					},
				]}
				emptyLabel="No workflows"
				stopLabel="Stop"
				noTranscriptLabel="No transcript"
				hasTranscript={false}
				messageList={null}
				onSelect={vi.fn()}
				onStop={vi.fn()}
			/>,
		);

		expect(html).toContain("Complete and verify the API contract.");
		expect(html).toContain("duration-200");
		expect(html).toContain('aria-label="Stop"');
		expect(html).toContain("icon-[solar--stop-circle-linear]");
	});

	it("wires workflow selection and stop actions to the host", () => {
		const onSelect = vi.fn();
		const onStop = vi.fn();
		render(
			<WorkflowTabPanelView
				items={[
					{
						id: "workflow-1",
						name: "API contract",
						progressLabel: "1/2",
						statusLabel: "Running",
						statusIcon: "icon-[solar--refresh-linear] animate-spin",
						statusClassName: "text-emerald-400",
						objective: "Complete and verify the API contract.",
						usageLabel: "800 tokens · $0.01",
						selected: true,
						active: true,
					},
				]}
				emptyLabel="No workflows"
				stopLabel="Stop"
				noTranscriptLabel="No transcript"
				hasTranscript={false}
				messageList={null}
				onSelect={onSelect}
				onStop={onStop}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /API contract/u }));
		fireEvent.click(screen.getByRole("button", { name: "Stop" }));

		expect(onSelect).toHaveBeenCalledWith("workflow-1");
		expect(onStop).toHaveBeenCalledWith("workflow-1");
	});
});
