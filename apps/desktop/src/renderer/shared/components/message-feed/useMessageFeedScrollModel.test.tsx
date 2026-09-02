// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { VirtuosoHandle } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMessageFeedScrollModel } from "./useMessageFeedScrollModel";

describe("useMessageFeedScrollModel", () => {
	afterEach(() => vi.unstubAllGlobals());

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
});
