// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { ListItem } from "react-virtuoso";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageFeedActiveItem } from "./useMessageFeedActiveItem";

/** 记录 scrollTop 被读了几次的假滚动容器：读它就是一次布局读取。 */
function scroller(): { element: HTMLElement; reads: () => number } {
	const element = document.createElement("div");
	let reads = 0;
	Object.defineProperty(element, "scrollTop", {
		get() {
			reads++;
			return 0;
		},
		set() {},
	});
	return { element, reads: () => reads };
}

function items(count: number): ListItem<unknown>[] {
	return Array.from({ length: count }, (_, index) => ({
		index,
		offset: index * 100,
		size: 100,
		data: undefined,
		originalIndex: index,
		type: "item" as const,
	})) as unknown as ListItem<unknown>[];
}

describe("useMessageFeedActiveItem", () => {
	describe("布局读取折叠", () => {
		let frames: Array<() => void>;
		beforeEach(() => {
			frames = [];
			vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
				frames.push(cb);
				return frames.length;
			});
			vi.stubGlobal("cancelAnimationFrame", () => {});
		});
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		/**
		 * 性能合同：虚拟列表在一次尺寸变化里会反复回调 itemsRendered，而回调紧跟在 DOM 写入
		 * 之后——同步读 scrollTop 就是一次强制同步布局，整条消息列表重排一遍。拖侧边栏宽度时
		 * 尺寸每帧都在变，实测这一处吃掉 750ms、把拖拽打到 p50 57ms。
		 */
		it("itemsRendered 连续回调只在下一帧读一次布局", () => {
			const { element, reads } = scroller();
			const { result } = renderHook(() =>
				useMessageFeedActiveItem<unknown>({ scrollerElement: element, initialIndex: 0 }),
			);
			// 挂载时排了一次同步，先把它冲掉，从干净的计数开始。
			act(() => {
				for (const frame of frames.splice(0)) frame();
			});
			const before = reads();

			act(() => {
				for (let i = 0; i < 10; i++) result.current.onItemsRendered(items(3));
			});
			expect(reads()).toBe(before);

			act(() => {
				for (const frame of frames.splice(0)) frame();
			});
			expect(reads()).toBe(before + 1);
		});
	});

	it("keeps the current item while a feed appends and resets only when its identity changes", () => {
		const { result, rerender } = renderHook(
			({ initialIndex, resetKey }) =>
				useMessageFeedActiveItem<unknown>({
					scrollerElement: null,
					initialIndex,
					resetKey,
				}),
			{ initialProps: { initialIndex: 1, resetKey: "feed-a" } },
		);

		rerender({ initialIndex: 4, resetKey: "feed-a" });
		expect(result.current.activeIndex).toBe(1);

		rerender({ initialIndex: 4, resetKey: "feed-b" });
		expect(result.current.activeIndex).toBe(4);
	});
});
