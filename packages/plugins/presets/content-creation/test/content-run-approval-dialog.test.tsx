// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRunApprovalDialog } from "../src/plugin/ContentRunApprovalDialog";
import {
	clearContentRunApprovals,
	getPendingContentRunIds,
	requestContentRunApproval,
} from "../src/plugin/run-approval";

const runtime = vi.hoisted(() => ({
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

vi.mock("../src/plugin/runtime", () => ({
	getContentCreationAgentService: () => ({
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
		startRun: runtime.startRun,
		cancelRun: runtime.cancelRun,
		subscribeRuns: runtime.subscribeRuns,
	}),
	getContentCreationWorkspace: () => ({ subscribe: runtime.subscribeProject }),
}));

describe("ContentRunApprovalDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearContentRunApprovals();
	});

	afterEach(cleanup);

	it("starts a prepared run only after global confirmation", async () => {
		requestContentRunApproval("run-id");
		render(<ContentRunApprovalDialog />);

		expect(runtime.startRun).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("runApproval.confirm"));
		await waitFor(() => expect(runtime.startRun).toHaveBeenCalledWith("run-id"));
		expect(getPendingContentRunIds()).toEqual([]);
	});

	it("cancels a prepared run when the dialog is dismissed", () => {
		requestContentRunApproval("run-id");
		render(<ContentRunApprovalDialog />);

		fireEvent.click(screen.getByText("runApproval.cancel"));
		expect(runtime.cancelRun).toHaveBeenCalledWith("run-id");
		expect(getPendingContentRunIds()).toEqual([]);
	});
});
