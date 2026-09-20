// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { VirtuosoHandle } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMessageFeedScrollModel } from "./useMessageFeedScrollModel";

describe("useMessageFeedScrollModel", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("stops the follow loop once the viewport is already at the bottom", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);

		const { result } = renderHook(() =>
			useMessageFeedScrollModel({
				active: true,
				items: [{ id: "message-1" }],
				resetKey: "feed-1",
			}),
		);
		const element = document.createElement("div");
		Object.defineProperties(element, {
			scrollHeight: { configurable: true, value: 1000 },
			clientHeight: { configurable: true, value: 400 },
			scrollTop: { configurable: true, writable: true, value: 600 },
		});

		act(() => result.current.scrollerRef(element));
		act(() => result.current.onAtBottomChange(true));
		expect(frames).toHaveLength(1);

		act(() => frames.shift()?.(0));

		expect(frames).toHaveLength(0);
	});

	it("coalesces resize-follow corrections into one animation frame", () => {
		const frames: FrameRequestCallback[] = [];
		let notifyResize: (() => void) | undefined;
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: () => void) {
					notifyResize = callback;
				}
				observe() {}
				disconnect() {}
			},
		);

		const { result } = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ id: "message-1" }],
				resetKey: "feed-1",
			}),
		);
		const element = document.createElement("div");
		Object.defineProperties(element, {
			scrollHeight: { configurable: true, value: 1200 },
			clientHeight: { configurable: true, value: 400 },
			scrollTop: { configurable: true, writable: true, value: 600 },
		});

		act(() => result.current.scrollerRef(element));
		frames.splice(0);
		act(() => {
			notifyResize?.();
			notifyResize?.();
		});

		expect(frames).toHaveLength(1);
		expect(element.scrollTop).toBe(600);

		act(() => frames.shift()?.(0));

		expect(element.scrollTop).toBe(800);
	});

	it("navigates an arbitrary feed item model without a chat message dependency", () => {
		const scrollToIndex = vi.fn();
		const { result } = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ logicalKey: "event-1" }],
				resetKey: "feed-1",
				getItemKey: (item) => item.logicalKey,
			}),
		);
		(result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;

		act(() => result.current.scrollToItem(3));

		expect(scrollToIndex).toHaveBeenCalledWith({ index: 3, align: "start", behavior: "smooth" });
		expect(result.current.historyBufferEnabled).toBe(true);
	});

	it("resolves an initial target through a scenario-provided logical key", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		const scrollToIndex = vi.fn();
		const onInitialTargetHandled = vi.fn();
		const { result } = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ logicalKey: "first" }, { logicalKey: "target" }],
				resetKey: "feed-1",
				initialTargetKey: "target",
				getItemKey: (item) => item.logicalKey,
				onInitialTargetHandled,
			}),
		);
		(result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;

		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});

		expect(onInitialTargetHandled).toHaveBeenCalledOnce();
		expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, align: "center", behavior: "smooth" });
	});

	it("keeps the tail lightweight until the user starts browsing history", () => {
		vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		const { result } = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ id: "message-1" }],
				resetKey: "feed-1",
			}),
		);
		const element = document.createElement("div");

		act(() => result.current.scrollerRef(element));

		expect(result.current).toMatchObject({ followOutput: "auto", historyBufferEnabled: false });

		act(() => element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 })));

		expect(result.current).toMatchObject({ followOutput: false, historyBufferEnabled: true });

		act(() => result.current.onAtBottomChange(true));

		expect(result.current).toMatchObject({ followOutput: "auto", historyBufferEnabled: true });
	});

	it("recognizes an upward scrollbar drag as history-browsing intent", () => {
		vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		const { result } = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ id: "message-1" }],
				resetKey: "feed-pointer",
			}),
		);
		const element = document.createElement("div");
		Object.defineProperty(element, "scrollTop", { configurable: true, writable: true, value: 600 });

		act(() => result.current.scrollerRef(element));
		act(() => element.dispatchEvent(new MouseEvent("pointerdown", { button: 0 })));
		element.scrollTop = 400;
		act(() => element.dispatchEvent(new Event("scroll")));

		expect(result.current).toMatchObject({ followOutput: false, historyBufferEnabled: true });
	});

	it("coalesces virtual total-height changes and pins the tail only while follow intent is active", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		const { result } = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ id: "message-1" }],
				resetKey: "feed-height",
			}),
		);
		const element = document.createElement("div");
		Object.defineProperties(element, {
			scrollHeight: { configurable: true, writable: true, value: 1200 },
			clientHeight: { configurable: true, value: 400 },
			scrollTop: { configurable: true, writable: true, value: 600 },
		});

		act(() => result.current.scrollerRef(element));
		frames.splice(0);
		act(() => {
			result.current.onTotalListHeightChange(1100);
			result.current.onTotalListHeightChange(1200);
		});

		expect(frames).toHaveLength(1);
		act(() => frames.shift()?.(0));
		expect(element.scrollTop).toBe(800);

		act(() => element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 })));
		Object.defineProperty(element, "scrollHeight", { configurable: true, writable: true, value: 1600 });
		act(() => result.current.onTotalListHeightChange(1600));

		expect(frames).toHaveLength(0);
		expect(element.scrollTop).toBe(800);
	});

	it("does not leak history-browsing state into the next session", () => {
		vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		const { result, rerender } = renderHook(
			({ resetKey }) =>
				useMessageFeedScrollModel({
					active: false,
					items: [{ id: "message-1" }],
					resetKey,
				}),
			{ initialProps: { resetKey: "feed-a" } },
		);
		const element = document.createElement("div");

		act(() => result.current.scrollerRef(element));
		act(() => element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 })));
		expect(result.current.historyBufferEnabled).toBe(true);

		rerender({ resetKey: "feed-b" });

		expect(result.current).toMatchObject({ followOutput: "auto", historyBufferEnabled: false });
	});

	it("keeps the initial index stable while an empty session hydrates", () => {
		const { result, rerender } = renderHook(
			({ items }: { items: Array<{ id: string }> }) =>
				useMessageFeedScrollModel({
					active: false,
					items,
					resetKey: "progressive-feed",
				}),
			{ initialProps: { items: [] as Array<{ id: string }> } },
		);

		expect(result.current).toMatchObject({ initialTopMostItemIndex: 0 });

		rerender({ items: Array.from({ length: 25 }, (_, index) => ({ id: `message-${index}` })) });

		expect(result.current).toMatchObject({ initialTopMostItemIndex: 0 });
	});

	it("caches measured item state and exposes it for a later remount", () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		const resetKey = `feed-state-${Math.random()}`;
		const snapshot = {
			scrollTop: 240,
			ranges: [{ startIndex: 0, endIndex: 1, size: 180 }],
		};
		const first = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ id: "message-1" }, { id: "message-2" }],
				resetKey,
			}),
		);
		(first.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			getState: (callback: (state: typeof snapshot) => void) => callback(snapshot),
		} as unknown as VirtuosoHandle;
		const element = document.createElement("div");
		act(() => first.result.current.scrollerRef(element));
		first.unmount();

		const second = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ id: "message-1" }, { id: "message-2" }],
				resetKey,
			}),
		);

		expect(second.result.current).toMatchObject({
			followOutput: false,
			historyBufferEnabled: true,
			restoreStateFrom: snapshot,
			initialTopMostItemIndex: undefined,
		});
		second.unmount();

		const progressive = renderHook(
			({ items }: { items: Array<{ id: string }> }) =>
				useMessageFeedScrollModel({
					active: false,
					items,
					resetKey,
				}),
			{ initialProps: { items: [] as Array<{ id: string }> } },
		);

		expect(progressive.result.current.restoreStateFrom).toBeUndefined();

		progressive.rerender({ items: [{ id: "message-1" }, { id: "message-2" }] });

		expect(progressive.result.current.restoreStateFrom).toBeUndefined();
		progressive.unmount();
	});
});
