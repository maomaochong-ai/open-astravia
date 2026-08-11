// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRunApprovalDialog } from "../src/plugin/ContentRunApprovalDialog";
import { ContentRunApprovalStore } from "../src/plugin/run-approval";
import type { ContentCreationPluginRuntime } from "../src/plugin/runtime";

const runtimeCalls = vi.hoisted(() => ({
	startRun: vi.fn(async () => undefined),
	cancelRun: vi.fn(),
	subscribeRuns: vi.fn(() => () => undefined),
	subscribeProject: vi.fn(() => () => undefined),
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

interface MockDialogProps {
	open: boolean;
	children: ReactNode;
}

interface MockButtonProps extends ComponentProps<"button"> {
	variant?: string;
}

vi.mock("@vetta/ui", () => ({
	Dialog: ({ open, children }: MockDialogProps) => (open ? <div>{children}</div> : null),
	DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	Button: ({ variant: _variant, children, ...props }: MockButtonProps) => <button {...props}>{children}</button>,
}));

const runApprovals = new ContentRunApprovalStore();
const pluginRuntime = {
	agent: {
		getRun: (runId: string) => ({
			id: runId,
			cwd: "C:/project",
			projectId: "project",
			expectedRevision: 1,
			nodeIds: ["image"],
			status: "awaiting-confirmation",
			completedNodeIds: [],
			failedNodeIds: [],
			skippedNodeIds: [],
		}),
		startRun: runtimeCalls.startRun,
		cancelRun: runtimeCalls.cancelRun,
		subscribeRuns: runtimeCalls.subscribeRuns,
	},
	workspace: { subscribe: runtimeCalls.subscribeProject },
	runApprovals,
} as unknown as ContentCreationPluginRuntime;

describe("ContentRunApprovalDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runApprovals.clear();
	});

	afterEach(cleanup);

	it("starts a prepared run only after global confirmation", async () => {
		runApprovals.request("run-id");
		render(<ContentRunApprovalDialog runtime={pluginRuntime} />);

		expect(runtimeCalls.startRun).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("runApproval.confirm"));
		await waitFor(() => expect(runtimeCalls.startRun).toHaveBeenCalledWith("run-id"));
		expect(runApprovals.getSnapshot()).toEqual([]);
	});

	it("cancels a prepared run when the dialog is dismissed", () => {
		runApprovals.request("run-id");
		render(<ContentRunApprovalDialog runtime={pluginRuntime} />);

		fireEvent.click(screen.getByText("runApproval.cancel"));
		expect(runtimeCalls.cancelRun).toHaveBeenCalledWith("run-id");
		expect(runApprovals.getSnapshot()).toEqual([]);
	});
});
