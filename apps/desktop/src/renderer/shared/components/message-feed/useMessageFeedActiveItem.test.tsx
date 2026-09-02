// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMessageFeedActiveItem } from "./useMessageFeedActiveItem";

describe("useMessageFeedActiveItem", () => {
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
