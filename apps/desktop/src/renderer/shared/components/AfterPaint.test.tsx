// @vitest-environment jsdom

import type { DesktopActionApprovalApi, DesktopActionApprovalRequest } from "@preload/api";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionApprovalCenter } from "../action-approval/ActionApprovalCenter";
import { useActionApproval } from "../action-approval/useActionApproval";
import { AfterPaint } from "./AfterPaint";

function Presenter(): JSX.Element | null {
	const approval = useActionApproval("generic");
	return approval ? <button onClick={() => approval.approve()}>{approval.request.title}</button> : null;
}

function setupFrames(): FrameRequestCallback[] {
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
	return frames;
}

async function paint(frames: FrameRequestCallback[]): Promise<void> {
	await act(async () => {
		for (const callback of frames.splice(0)) callback(0);
	});
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("secondary UI after paint", () => {
	it("receives approvals before presenters load, then lets the user approve queued requests in order", async () => {
		const frames = setupFrames();
		let receive: Parameters<DesktopActionApprovalApi["onRequest"]>[0] | undefined;
		const disposeRequest = vi.fn();
		const disposeTimeout = vi.fn();
		const respond = vi.fn<DesktopActionApprovalApi["respond"]>().mockResolvedValue(true);
		const actionApproval: DesktopActionApprovalApi = {
			onRequest: (handler) => {
				receive = handler;
				return disposeRequest;
			},
			onTimeout: () => disposeTimeout,
			respond,
		};
		vi.stubGlobal("vetta", { actionApproval });
		const view = render(
			<Provider store={createStore()}>
				<ActionApprovalCenter />
				<div>Application content</div>
				<AfterPaint>
					<Presenter />
				</AfterPaint>
			</Provider>,
		);
		const request = (id: string): DesktopActionApprovalRequest => ({
			approvalId: id,
			actionId: "test",
			approvalPresentation: "generic",
			expiresAt: Date.now() + 60_000,
			input: {},
			title: id,
			summary: "Pending operation",
			permission: "test",
		});
		act(() => {
			receive?.(request("First"));
			receive?.(request("Second"));
		});
		expect(screen.getByText("Application content")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
		await paint(frames);
		expect(screen.queryByRole("button")).toBeNull();
		await paint(frames);
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "First" })));
		expect(respond).toHaveBeenCalledWith("First", true, undefined);
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "Second" })));
		expect(respond).toHaveBeenCalledWith("Second", true, undefined);
		expect(screen.queryByRole("button")).toBeNull();
		view.unmount();
		expect(disposeRequest).toHaveBeenCalledOnce();
		expect(disposeTimeout).toHaveBeenCalledOnce();
	});

	it("does not initialize secondary UI when unmounted before paint, including StrictMode effect replay", async () => {
		const frames = setupFrames();
		const started = vi.fn();
		function Secondary(): null {
			useEffect(started, []);
			return null;
		}
		const view = render(
			<StrictMode>
				<AfterPaint>
					<Secondary />
				</AfterPaint>
			</StrictMode>,
		);
		await paint(frames);
		view.unmount();
		await paint(frames);
		expect(started).not.toHaveBeenCalled();
	});
});
