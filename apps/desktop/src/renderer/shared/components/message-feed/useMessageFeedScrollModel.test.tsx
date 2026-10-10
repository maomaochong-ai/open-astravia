// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { VirtuosoHandle } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMessageFeedScrollModel } from "./useMessageFeedScrollModel";

describe("useMessageFeedScrollModel", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

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
		expect(result.current.followOutput).toBe(false);
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

	it("stops following the tail when the user starts browsing history", () => {
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

		expect(result.current.followOutput).toBe("auto");

		act(() => element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 })));

		expect(result.current.followOutput).toBe(false);

		act(() => result.current.onAtBottomChange(true));

		expect(result.current.followOutput).toBe(false);

		act(() => element.dispatchEvent(new Event("scrollend")));

		expect(result.current.followOutput).toBe(false);
	});

	it("re-enables tail following only after the user scrolls downward to the bottom", () => {
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
				resetKey: "feed-return-bottom",
			}),
		);
		const element = document.createElement("div");

		act(() => result.current.scrollerRef(element));
		act(() => element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 })));
		act(() => result.current.onAtBottomChange(true));
		expect(result.current.followOutput).toBe(false);

		act(() => element.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 })));
		act(() => result.current.onAtBottomChange(true));

		expect(result.current.followOutput).toBe("auto");
	});

	it("shows the bottom shortcut only when the viewport is more than 500px from the tail", () => {
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
				resetKey: "feed-bottom-shortcut",
				initialTargetKey: "history",
			}),
		);
		const element = document.createElement("div");
		Object.defineProperties(element, {
			scrollHeight: { configurable: true, value: 1400 },
			clientHeight: { configurable: true, value: 400 },
			scrollTop: { configurable: true, writable: true, value: 500 },
		});

		act(() => result.current.scrollerRef(element));
		act(() => element.dispatchEvent(new Event("scroll")));
		act(() => frames.shift()?.(0));
		expect(result.current.showScrollToBottom).toBe(false);

		element.scrollTop = 499;
		act(() => element.dispatchEvent(new Event("scroll")));
		act(() => frames.shift()?.(0));
		expect(result.current.showScrollToBottom).toBe(true);

		element.scrollTop = 501;
		act(() => element.dispatchEvent(new Event("scroll")));
		act(() => frames.shift()?.(0));
		expect(result.current.showScrollToBottom).toBe(false);
	});

	it("returns to the tail and resumes streaming follow from the bottom shortcut", () => {
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
				active: true,
				items: [{ id: "message-1" }],
				resetKey: "feed-bottom-action",
			}),
		);
		const scrollToIndex = vi.fn();
		(result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;
		const element = document.createElement("div");

		act(() => result.current.scrollerRef(element));
		act(() => element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 })));
		expect(result.current.followOutput).toBe(false);

		act(() => result.current.scrollToBottom());

		expect(result.current.followOutput).toBe("auto");
		expect(scrollToIndex).toHaveBeenCalledWith({ index: "LAST", align: "end", behavior: "smooth" });
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

		expect(result.current.followOutput).toBe(false);
	});

	it("does not read scrollTop on the wheel-scroll hot path", () => {
		vi.useFakeTimers();
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
				resetKey: "feed-wheel-layout",
			}),
		);
		const readScrollTop = vi.fn(() => 600);
		const element = document.createElement("div");
		Object.defineProperty(element, "scrollTop", { configurable: true, get: readScrollTop });

		act(() => result.current.scrollerRef(element));
		readScrollTop.mockClear();
		act(() => {
			element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
			element.dispatchEvent(new Event("scroll"));
		});

		expect(readScrollTop).not.toHaveBeenCalled();
	});

	it("captures state once after scrolling settles instead of on every scroll frame", () => {
		vi.useFakeTimers();
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
				resetKey: "feed-scroll-capture",
			}),
		);
		const getState = vi.fn();
		(result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			getState,
		} as unknown as VirtuosoHandle;
		const element = document.createElement("div");

		act(() => result.current.scrollerRef(element));
		act(() => {
			element.dispatchEvent(new Event("scroll"));
			element.dispatchEvent(new Event("scroll"));
			element.dispatchEvent(new Event("scroll"));
		});
		expect(getState).not.toHaveBeenCalled();

		act(() => vi.advanceTimersByTime(250));

		expect(getState).toHaveBeenCalledOnce();
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

	it("does not leak history-browsing follow state into the next session", () => {
		vi.useFakeTimers();
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
		act(() => {
			element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
			element.dispatchEvent(new Event("scroll"));
		});
		expect(result.current.followOutput).toBe(false);

		rerender({ resetKey: "feed-b" });
		act(() => vi.advanceTimersByTime(250));

		expect(result.current.followOutput).toBe("auto");
	});

	it("lands on the newest message when a session hydrates after mounting empty", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const { result, rerender } = renderHook(
			({ items }: { items: Array<{ id: string }> }) =>
				useMessageFeedScrollModel({
					active: false,
					items,
					resetKey: "progressive-feed",
				}),
			{ initialProps: { items: [] as Array<{ id: string }> } },
		);
		const scrollToIndex = vi.fn();
		(result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;

		expect(result.current.initialTopMostItemIndex).toEqual({ index: "LAST", align: "end" });
		expect(scrollToIndex).not.toHaveBeenCalled();

		rerender({ items: Array.from({ length: 25 }, (_, index) => ({ id: `message-${index}` })) });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});

		// 空列表上的 initialTopMostItemIndex 不会生效，历史到位后必须主动落到最新消息。
		expect(result.current.initialTopMostItemIndex).toEqual({ index: "LAST", align: "end" });
		expect(scrollToIndex).toHaveBeenCalledTimes(1);
		expect(scrollToIndex).toHaveBeenCalledWith({ index: "LAST", align: "end", behavior: "auto" });
		expect(result.current.followOutput).toBe("auto");

		rerender({ items: Array.from({ length: 26 }, (_, index) => ({ id: `message-${index}` })) });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});

		// 补位只发生一次，后续增长交给跟随循环，不再重复发起定位。
		expect(scrollToIndex).toHaveBeenCalledTimes(1);
	});

	it("does not issue a second tail scroll when switching sessions", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const items = [{ id: "message-1" }];
		const { result, rerender } = renderHook(
			({ resetKey }) =>
				useMessageFeedScrollModel({
					active: false,
					items,
					resetKey,
				}),
			{ initialProps: { resetKey: "feed-a" } },
		);
		const scrollToIndex = vi.fn();
		(result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;
		frames.splice(0);

		rerender({ resetKey: "feed-b" });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});

		expect(result.current.initialTopMostItemIndex).toEqual({ index: "LAST", align: "end" });
		expect(scrollToIndex).not.toHaveBeenCalled();
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

	it("restores the saved position when a session hydrates after mounting empty", () => {
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
		const resetKey = `feed-restore-${Math.random()}`;
		const items = Array.from({ length: 5 }, (_, index) => ({ id: `message-${index}` }));
		const snapshot = {
			scrollTop: 500,
			ranges: [{ startIndex: 0, endIndex: 4, size: 200 }],
		};

		// First visit: mount with items, capture the snapshot on unmount.
		const first = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items,
				resetKey,
			}),
		);
		(first.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			getState: (callback: (state: typeof snapshot) => void) => callback(snapshot),
		} as unknown as VirtuosoHandle;
		const element = document.createElement("div");
		act(() => first.result.current.scrollerRef(element));
		first.unmount();

		// Second visit: mount empty, then hydrate with the same items.
		const scrollToIndex = vi.fn();
		const second = renderHook(
			({ items: nextItems }: { items: Array<{ id: string }> }) =>
				useMessageFeedScrollModel({
					active: false,
					items: nextItems,
					resetKey,
				}),
			{ initialProps: { items: [] as Array<{ id: string }> } },
		);
		(second.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;

		expect(second.result.current.restoreStateFrom).toBeUndefined();

		second.rerender({ items });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});

		// 命中缓存快照：按 scrollTop+ranges 还原离开时的位置（第 2 条、内部 100px），而非尾部。
		expect(scrollToIndex).toHaveBeenCalledTimes(1);
		expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: "start", offset: 100, behavior: "auto" });
		expect(second.result.current.followOutput).toBe(false);
		second.unmount();
	});

	it("falls back to the tail when the hydrated list no longer matches the cached snapshot", () => {
		vi.useFakeTimers();
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
		const resetKey = `feed-restore-mismatch-${Math.random()}`;
		const items = Array.from({ length: 5 }, (_, index) => ({ id: `message-${index}` }));
		const snapshot = {
			scrollTop: 500,
			ranges: [{ startIndex: 0, endIndex: 4, size: 200 }],
		};

		const first = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items,
				resetKey,
			}),
		);
		(first.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			getState: (callback: (state: typeof snapshot) => void) => callback(snapshot),
		} as unknown as VirtuosoHandle;
		const element = document.createElement("div");
		act(() => first.result.current.scrollerRef(element));
		first.unmount();

		const scrollToIndex = vi.fn();
		const second = renderHook(
			({ items: nextItems }: { items: Array<{ id: string }> }) =>
				useMessageFeedScrollModel({
					active: false,
					items: nextItems,
					resetKey,
				}),
			{ initialProps: { items: [] as Array<{ id: string }> } },
		);
		(second.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;

		// 列表数量变了（6 条 > 快照的 5 条），已超过快照规模且仍不匹配 → 立即尾部落地。
		second.rerender({ items: Array.from({ length: 6 }, (_, index) => ({ id: `message-${index}` })) });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});

		expect(scrollToIndex).toHaveBeenCalledTimes(1);
		expect(scrollToIndex).toHaveBeenCalledWith({ index: "LAST", align: "end", behavior: "auto" });
		expect(second.result.current.followOutput).toBe("auto");
		second.unmount();
		vi.useRealTimers();
	});

	it("waits for the full list when the preview batch does not match the cached snapshot", () => {
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
		const resetKey = `feed-two-stage-${Math.random()}`;
		const fullItems = Array.from({ length: 82 }, (_, index) => ({ id: `message-${index}` }));
		const previewItems = fullItems.slice(-5); // last 5 of the full list
		const snapshot = {
			scrollTop: 5000,
			ranges: [{ startIndex: 0, endIndex: 81, size: 200 }],
		};

		// First visit: mount with full 82 items, capture snapshot.
		const first = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: fullItems,
				resetKey,
			}),
		);
		(first.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			getState: (callback: (state: typeof snapshot) => void) => callback(snapshot),
		} as unknown as VirtuosoHandle;
		const element = document.createElement("div");
		act(() => first.result.current.scrollerRef(element));
		first.unmount();

		// Second visit: mount empty → preview (5) → full (82).
		const scrollToIndex = vi.fn();
		const second = renderHook(
			({ items: nextItems }: { items: Array<{ id: string }> }) =>
				useMessageFeedScrollModel({
					active: false,
					items: nextItems,
					resetKey,
				}),
			{ initialProps: { items: [] as Array<{ id: string }> } },
		);
		(second.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;

		// Stage 1: preview batch (5 items) — should NOT scroll (waiting for full list).
		second.rerender({ items: previewItems });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});
		expect(scrollToIndex).not.toHaveBeenCalled();

		// Stage 2: full list (82 items) — should restore from snapshot.
		second.rerender({ items: fullItems });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});
		expect(scrollToIndex).toHaveBeenCalledTimes(1);
		// scrollTop=5000, range size=200 → index=25, offset=0
		expect(scrollToIndex).toHaveBeenCalledWith({ index: 25, align: "start", offset: 0, behavior: "auto" });
		expect(second.result.current.followOutput).toBe(false);
		second.unmount();
	});

	it("arms and waits when mounting directly on a preview batch that does not match the cache", () => {
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
		const resetKey = `feed-mount-preview-${Math.random()}`;
		const fullItems = Array.from({ length: 86 }, (_, index) => ({ id: `message-${index}` }));
		const previewItems = fullItems.slice(-7);
		const snapshot = {
			scrollTop: 9300,
			ranges: [{ startIndex: 0, endIndex: 85, size: 230 }],
		};

		const first = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: fullItems,
				resetKey,
			}),
		);
		(first.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			getState: (callback: (state: typeof snapshot) => void) => callback(snapshot),
		} as unknown as VirtuosoHandle;
		const element = document.createElement("div");
		act(() => first.result.current.scrollerRef(element));
		first.unmount();

		// 复现生产场景：重挂载时列表已经是预览批（7 条），缓存是完整列表（86 条）。
		const scrollToIndex = vi.fn();
		const second = renderHook(
			({ items: nextItems }: { items: Array<{ id: string }> }) =>
				useMessageFeedScrollModel({
					active: false,
					items: nextItems,
					resetKey,
				}),
			{ initialProps: { items: previewItems } },
		);
		(second.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;

		// 预览批不匹配 → 不发定位，等完整历史
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});
		expect(scrollToIndex).not.toHaveBeenCalled();

		// 完整历史到位 → 精确还原
		second.rerender({ items: fullItems });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});
		expect(scrollToIndex).toHaveBeenCalledWith({ index: 40, align: "start", offset: 100, behavior: "auto" });
		expect(second.result.current.followOutput).toBe(false);
		second.unmount();
	});

	it("does not let a preview batch overwrite the cached full-list snapshot", () => {
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
		const resetKey = `feed-no-poison-${Math.random()}`;
		const fullItems = Array.from({ length: 86 }, (_, index) => ({ id: `message-${index}` }));
		const previewItems = fullItems.slice(-7);
		const snapshot = {
			scrollTop: 9300,
			ranges: [{ startIndex: 0, endIndex: 85, size: 230 }],
		};

		// 首次访问：完整列表 + getState → 写入好快照
		const first = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: fullItems,
				resetKey,
			}),
		);
		(first.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			getState: (callback: (state: typeof snapshot) => void) => callback(snapshot),
		} as unknown as VirtuosoHandle;
		const element = document.createElement("div");
		act(() => first.result.current.scrollerRef(element));
		first.unmount();

		// 第二次访问：空挂载 → 预览批。预览阶段触发 captureState 必须被守卫拦下。
		const scrollToIndex = vi.fn();
		const second = renderHook(
			({ items: nextItems }: { items: Array<{ id: string }> }) =>
				useMessageFeedScrollModel({
					active: false,
					items: nextItems,
					resetKey,
				}),
			{ initialProps: { items: [] as Array<{ id: string }> } },
		);
		const previewGetState = vi.fn((callback: (state: typeof snapshot) => void) =>
			callback({ scrollTop: 7534, ranges: [{ startIndex: 0, endIndex: 6, size: 1076 }] }),
		);
		(second.result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
			getState: previewGetState,
		} as unknown as VirtuosoHandle;

		second.rerender({ items: previewItems });
		act(() => {
			// 预览批落地会触发 scrollend → settleScroll → captureState
			element.dispatchEvent(new Event("scroll"));
			for (const callback of frames.splice(0)) callback(0);
		});

		// 预览阶段不得写入缓存：完整列表到位后仍能命中原始快照
		second.rerender({ items: fullItems });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});
		expect(scrollToIndex).toHaveBeenCalledWith({ index: 40, align: "start", offset: 100, behavior: "auto" });
		second.unmount();
	});
});
