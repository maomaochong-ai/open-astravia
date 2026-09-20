// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMessageText } from "@vetta-org/theme-ui/chat";
import { Fragment } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let scrollHeightSpy: ReturnType<typeof vi.spyOn>;
let clientHeightSpy: ReturnType<typeof vi.spyOn>;

class TestResizeObserver implements ResizeObserver {
	readonly observe = vi.fn();
	readonly unobserve = vi.fn();
	readonly disconnect = vi.fn();

	constructor(_callback: ResizeObserverCallback) {}
}

beforeEach(() => {
	frameCallbacks.clear();
	nextFrameId = 1;
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => {
			const frameId = nextFrameId++;
			frameCallbacks.set(frameId, callback);
			return frameId;
		}),
	);
	vi.stubGlobal(
		"cancelAnimationFrame",
		vi.fn((frameId: number) => frameCallbacks.delete(frameId)),
	);
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	scrollHeightSpy = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(320);
	clientHeightSpy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(160);
});

afterEach(() => {
	cleanup();
	scrollHeightSpy.mockRestore();
	clientHeightSpy.mockRestore();
	vi.unstubAllGlobals();
});

describe("UserMessageText overflow measurement", () => {
	it("批量恢复历史消息时先绘制内容，再在同一帧批量测量溢出", () => {
		render(
			<>
				{Array.from({ length: 20 }, (_, index) => (
					<Fragment key={index}>
						<UserMessageText contentKey={`message-${index}`} entryState="static" expandLabel="展开">
							第 {index + 1} 条历史消息
						</UserMessageText>
					</Fragment>
				))}
			</>,
		);

		expect(screen.getByText("第 1 条历史消息")).toBeTruthy();
		expect(scrollHeightSpy).not.toHaveBeenCalled();
		expect(clientHeightSpy).not.toHaveBeenCalled();
		expect(requestAnimationFrame).toHaveBeenCalledOnce();

		act(() => {
			const callbacks = [...frameCallbacks.values()];
			frameCallbacks.clear();
			for (const callback of callbacks) callback(performance.now());
		});
		expect(scrollHeightSpy).not.toHaveBeenCalled();
		expect(clientHeightSpy).not.toHaveBeenCalled();
		expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

		act(() => {
			const callbacks = [...frameCallbacks.values()];
			frameCallbacks.clear();
			for (const callback of callbacks) callback(performance.now());
		});

		expect(scrollHeightSpy).toHaveBeenCalledTimes(20);
		expect(clientHeightSpy).toHaveBeenCalledTimes(20);
		expect(screen.getAllByRole("button", { name: "展开" })).toHaveLength(20);
	});

	it("异步测量后仍可展开长消息", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<UserMessageText contentKey="message-long" entryState="static" expandLabel="展开">
				长消息
			</UserMessageText>,
		);

		act(() => {
			const callbacks = [...frameCallbacks.values()];
			frameCallbacks.clear();
			for (const callback of callbacks) callback(performance.now());
		});
		act(() => {
			const callbacks = [...frameCallbacks.values()];
			frameCallbacks.clear();
			for (const callback of callbacks) callback(performance.now());
		});

		const message = container.firstElementChild as HTMLElement;
		expect(message.style.maxHeight).toBe("16em");
		await user.click(within(container).getByRole("button", { name: "展开" }));
		expect(message.style.maxHeight).toBe("");
	});
});
