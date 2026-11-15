// @vitest-environment jsdom
// 守住归属边界与预算门控。
//
// 两条路径必须分开看：
// 1. 用户消息路径（宿主不传 `isStreamingTail`）：`rehypeStreamingChunks` 从不挂载，
// 因此分段预算在这条路径上不生效——#185 的用户消息路径与此无关。
// 2. 助手尾块路径（`isStreamingTail=true`）：文本超过 `STREAM_CHUNK_MAX_CHARS` 后
//    不挂插件，`.streaming-chunk` 归零，但 `.markdown-streaming-tail` 包裹类保留。
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";
import { STREAM_CHUNK_MAX_CHARS } from "./streaming";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const environment = {
	theme: "dark" as const,
	labels: { copy: "Copy code", copied: "Copied code" },
	getFileIconClass: () => "",
	onOpenFile: () => {},
	onOpenUrl: () => {},
};

/** 超过逐字/分段预算的一整段文本。 */
const OVER_BUDGET = "诊断记录。".repeat(2_600);
/** 预算之内的短文本，用来先让分段挂上再跨过预算。 */
const SHORT = "诊断记录。".repeat(20);

interface Mounted {
	readonly container: HTMLElement;
	readonly root: Root;
}

function mount(text: string, isStreamingTail: boolean): Mounted {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(createElement(MarkdownContent, { ...environment, text, isStreamingTail }));
	});
	return { container, root };
}

function dispose(view: Mounted): void {
	act(() => {
		view.root.unmount();
	});
	view.container.remove();
}

describe("分段预算的路径归属", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("用户消息路径不传 isStreamingTail，因此从不挂分段插件", () => {
		expect(OVER_BUDGET.length).toBeGreaterThan(STREAM_CHUNK_MAX_CHARS);
		const view = mount(OVER_BUDGET, false);
		act(() => {
			vi.advanceTimersByTime(250);
		});
		// 用户消息路径与既有约束的分段预算无关：插件在这里本来就从未挂上。
		expect(view.container.querySelectorAll(".streaming-chunk").length).toBe(0);
		expect(view.container.querySelector(".markdown-streaming-tail")).toBeNull();
		// 正文仍然完整渲染。
		expect(view.container.textContent).toContain("诊断记录。");
		dispose(view);
	});

	it("助手尾块超过分段预算后不挂插件", () => {
		// 真实长回复是从短文本长过来的：先让分段挂上，再跨过预算。
		const view = mount(SHORT, true);
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(view.container.querySelectorAll(".streaming-chunk").length).toBeGreaterThan(0);

		act(() => {
			view.root.render(createElement(MarkdownContent, { ...environment, text: OVER_BUDGET, isStreamingTail: true }));
		});
		// 跨过预算后不产生逐短语 span。
		expect(view.container.querySelectorAll(".streaming-chunk").length).toBe(0);
		// 包裹类由 `animateChunks` 驱动，不随分段一起关。
		expect(view.container.querySelector(".markdown-streaming-tail")).not.toBeNull();
		dispose(view);
	});
});
