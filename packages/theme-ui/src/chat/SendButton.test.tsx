// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendButton } from "./SendButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS = { sendMessage: "发送", stopGenerating: "停止生成", stopping: "正在停止" };

let root: Root | null = null;

function mount(onAbort: () => void | Promise<void>): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(<SendButton canSend isStreaming labels={LABELS} onSend={() => {}} onAbort={onAbort} />);
	});
	return container;
}

function clickStop(container: HTMLElement): void {
	const button = container.querySelector("button");
	if (!button) throw new Error("send button is missing");
	act(() => {
		button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

function isAborting(container: HTMLElement): boolean {
	return container.querySelector("[data-aborting]")?.getAttribute("data-aborting") === "true";
}

function isButtonDisabled(container: HTMLElement): boolean {
	return container.querySelector("button")?.disabled ?? false;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = null;
	document.body.innerHTML = "";
	vi.useRealTimers();
});

describe("SendButton 停止生成", () => {
	it("取消一结算就回到可发送状态", async () => {
		let resolveAbort: (() => void) | undefined;
		const container = mount(
			() =>
				new Promise<void>((resolve) => {
					resolveAbort = resolve;
				}),
		);

		clickStop(container);
		expect(isAborting(container)).toBe(true);
		expect(isButtonDisabled(container)).toBe(true);

		// handleAbort 把 onAbort 排进了微任务，先让它真的跑起来，resolveAbort 才有值。
		await act(async () => {});
		await act(async () => {
			resolveAbort?.();
		});
		expect(isAborting(container)).toBe(false);
		expect(isButtonDisabled(container)).toBe(false);
	});

	it("取消请求永远不回话时，到点把按钮解出来而不是让它一直禁用", () => {
		// 断网后这条链路正是这样：取消要跨网络，主进程迟迟不返回，
		// 按钮就一直停在「正在停止」上，既不能再按也没法发下一条。
		const container = mount(() => new Promise<void>(() => {}));

		clickStop(container);
		expect(isButtonDisabled(container)).toBe(true);

		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(isAborting(container)).toBe(false);
		expect(isButtonDisabled(container)).toBe(false);
	});
});
