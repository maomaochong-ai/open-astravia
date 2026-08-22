// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { VirtuosoHandle } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";
import { useMessageListScrollModel } from "./useMessageListScrollModel";

describe("useMessageListScrollModel navigation", () => {
	it("uses the shared Virtuoso instance to jump to an exact message", () => {
		const scrollToIndex = vi.fn();
		const { result } = renderHook(() =>
			useMessageListScrollModel({
				isStreaming: true,
				messages: [{ id: "message-1", role: "user", text: "hello" }],
				sessionId: "session-1",
			}),
		);
		(result.current.virtuosoRef as { current: VirtuosoHandle | null }).current = {
			scrollToIndex,
		} as unknown as VirtuosoHandle;

		act(() => result.current.scrollToMessage(4));

		expect(scrollToIndex).toHaveBeenCalledWith({ index: 4, align: "start", behavior: "smooth" });
	});
});
