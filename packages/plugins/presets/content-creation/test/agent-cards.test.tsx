// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PluginCardProps } from "@vetta-org/plugin-sdk";
import { type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentChangePreviewCard, ContentRunCard } from "../src/plugin/AgentCards";

const runtime = vi.hoisted(() => ({
	commitPreview: vi.fn(async () => undefined),
	getRun: vi.fn(),
	startRun: vi.fn(async () => undefined),
	cancelRun: vi.fn(),
	subscribeRuns: vi.fn(() => () => undefined),
	subscribeProject: vi.fn(() => () => undefined),
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

interface MockButtonProps extends ComponentProps<"button"> {
	size?: string;
	variant?: string;
	children?: ReactNode;
}

vi.mock("@vetta/ui", () => ({
	Button: ({ size: _size, variant: _variant, children, ...props }: MockButtonProps) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("../src/plugin/runtime", () => ({
	getContentCreationAgentService: () => ({
		commitPreview: runtime.commitPreview,
		getRun: runtime.getRun,
		startRun: runtime.startRun,
		cancelRun: runtime.cancelRun,
		subscribeRuns: runtime.subscribeRuns,
	}),
	getContentCreationWorkspace: () => ({ subscribe: runtime.subscribeProject }),
}));

const message = {} as PluginCardProps["message"];

describe("content creation agent cards", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(cleanup);

	it("commits only after the user confirms a valid change preview", async () => {
		render(
			<ContentChangePreviewCard
				descriptor={{
					type: "content-creation:change-preview",
					payload: {
						token: "preview-token",
						projectId: "project",
						expectedRevision: 3,
						destructive: true,
						diff: {
							addedNodeIds: [],
							removedNodeIds: ["old-node"],
							updatedNodeIds: [],
							addedEdgeCount: 0,
							removedEdgeCount: 1,
							workflowChanged: false,
						},
					},
				}}
				pending={false}
				message={message}
			/>,
		);

		expect(runtime.commitPreview).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("card.preview.confirm"));
		await waitFor(() => expect(runtime.commitPreview).toHaveBeenCalledWith("preview-token"));
		expect(screen.getByText("card.preview.applied")).toBeTruthy();
	});

	it("starts a prepared generation run only from its confirmation button", async () => {
		runtime.getRun.mockReturnValue({
			id: "run-id",
			cwd: "C:/project",
			projectId: "project",
			expectedRevision: 4,
			nodeIds: ["video"],
			status: "awaiting-confirmation",
			completedNodeIds: [],
			failedNodeIds: [],
			skippedNodeIds: [],
		});
		render(
			<ContentRunCard
				descriptor={{ type: "content-creation:run", payload: { runId: "run-id" } }}
				pending={false}
				message={message}
			/>,
		);

		expect(runtime.startRun).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("card.run.start"));
		await waitFor(() => expect(runtime.startRun).toHaveBeenCalledWith("run-id"));
	});
});
