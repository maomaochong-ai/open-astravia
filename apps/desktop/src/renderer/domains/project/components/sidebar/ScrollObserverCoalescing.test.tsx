// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { QuickScrollOverlay } from "@vetta/theme-ui/project";
import { ScrollFade } from "@vetta/theme-ui/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 侧栏滚动辅助组件（ScrollFade / QuickScrollOverlay）的性能合同：
 * 1. 观察者/滚动回调必须 rAF 合帧——DOM 高频变动（虚拟列表换页、折叠动画）时
 *    每帧至多做一次强制布局读取，不允许每条 mutation/scroll 都同步读 scrollHeight。
 * 2. MutationObserver 只监听直接子节点（childList），不允许 subtree 全子树监听，
 *    否则列表任意行级变动都会触发回调，形成布局自激循环。
 */

type FrameCallback = FrameRequestCallback;

let frameQueue: Map<number, FrameCallback>;
let nextFrameId: number;
let observeSpy: ReturnType<typeof vi.spyOn>;

function flushFrames(): void {
	const pending = [...frameQueue.values()];
	frameQueue.clear();
	act(() => {
		for (const callback of pending) callback(performance.now());
	});
}

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

beforeEach(() => {
	frameQueue = new Map();
	nextFrameId = 1;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameCallback): number => {
		const id = nextFrameId++;
		frameQueue.set(id, callback);
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
		frameQueue.delete(id);
	});
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	observeSpy = vi.spyOn(MutationObserver.prototype, "observe");
});

afterEach(() => {
	observeSpy.mockRestore();
	vi.unstubAllGlobals();
});

function defineScrollMetrics(el: HTMLElement, metrics: { scrollHeight: number; clientHeight: number }): void {
	Object.defineProperty(el, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
	Object.defineProperty(el, "clientHeight", { configurable: true, value: metrics.clientHeight });
}

describe("ScrollFade", () => {
	it("MutationObserver 只监听 childList，不监听 subtree", () => {
		render(
			<ScrollFade>
				<div>内容</div>
			</ScrollFade>,
		);
		expect(observeSpy).toHaveBeenCalled();
		for (const call of observeSpy.mock.calls) {
			const options = call[1] as MutationObserverInit | undefined;
			expect(options?.subtree).not.toBe(true);
			expect(options?.childList).toBe(true);
		}
	});

	it("连续多次 scroll 事件合并为一次 rAF 内的布局读取", () => {
		let el: HTMLDivElement | null = null;
		render(
			<ScrollFade onScrollRef={(node) => (el = node)}>
				<div>内容</div>
			</ScrollFade>,
		);
		expect(el).not.toBeNull();
		const target = el as unknown as HTMLDivElement;
		defineScrollMetrics(target, { scrollHeight: 500, clientHeight: 100 });

		fireEvent.scroll(target);
		fireEvent.scroll(target);
		fireEvent.scroll(target);
		expect(frameQueue.size).toBe(1);

		flushFrames();
		// 布局读取发生后：内容可继续滚动 → 应用底部渐隐 mask。
		expect(target.style.maskImage || target.style.webkitMaskImage).toContain("linear-gradient");
	});
});

describe("QuickScrollOverlay", () => {
	function renderOverlay(scrollElement: HTMLElement) {
		return render(
			<QuickScrollOverlay
				labels={{ top: "回到顶部", bottom: "去底部" }}
				scrollElement={scrollElement}
			>
				<div>列表</div>
			</QuickScrollOverlay>,
		);
	}

	it("MutationObserver 只监听 childList，不监听 subtree", () => {
		const scrollElement = document.createElement("div");
		renderOverlay(scrollElement);
		expect(observeSpy).toHaveBeenCalled();
		for (const call of observeSpy.mock.calls) {
			const options = call[1] as MutationObserverInit | undefined;
			expect(options?.subtree).not.toBe(true);
			expect(options?.childList).toBe(true);
		}
	});

	it("连续 scroll 合帧，一帧后按滚动位置更新上下轨可见性", () => {
		const scrollElement = document.createElement("div");
		defineScrollMetrics(scrollElement, { scrollHeight: 1000, clientHeight: 100 });
		scrollElement.scrollTop = 500;
		document.body.appendChild(scrollElement);

		const { getByLabelText } = renderOverlay(scrollElement);
		// 挂载时同步计算过一次；此后滚动全部合帧。
		fireEvent.scroll(scrollElement);
		fireEvent.scroll(scrollElement);
		expect(frameQueue.size).toBe(1);
		flushFrames();

		const topRail = getByLabelText("回到顶部");
		const bottomRail = getByLabelText("去底部");
		expect(topRail.hasAttribute("disabled")).toBe(false);
		expect(bottomRail.hasAttribute("disabled")).toBe(false);
		scrollElement.remove();
	});

	it("卸载时取消未执行的 rAF，不留悬挂回调", () => {
		const scrollElement = document.createElement("div");
		defineScrollMetrics(scrollElement, { scrollHeight: 1000, clientHeight: 100 });
		const { unmount } = renderOverlay(scrollElement);
		fireEvent.scroll(scrollElement);
		expect(frameQueue.size).toBe(1);
		unmount();
		expect(frameQueue.size).toBe(0);
	});
});
