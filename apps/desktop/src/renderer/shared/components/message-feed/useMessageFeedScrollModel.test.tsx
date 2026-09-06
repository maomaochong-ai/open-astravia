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

		expect(second.result.current.restoreStateFrom).toEqual(snapshot);
		second.unmount();
	});
});
