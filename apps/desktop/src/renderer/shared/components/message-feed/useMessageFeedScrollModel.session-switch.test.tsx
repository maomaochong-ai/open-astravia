// @vitest-environment jsdom
/**
 * #7：会话切换后消息列表停在顶部的回归测试（适配现有实现）。
 *
 * 竞态根因（源码实读）：`initialTopMostItemIndex` 只在首次渲染按当时 items 计算
 * 一次；会话切换时列表先以空数组挂载、随后历史补齐，首帧的空列表让
 * INITIAL_TAIL_LOCATION 无从生效。
 *
 * 现有修复（useMessageFeedScrollModel.ts 的 pendingInitialTail 分支）不依赖
 * initialTopMostItemIndex 的返回值，而是在历史补齐的 useEffect 里对 virtuoso
 * 补一次 scrollToIndex({LAST})。因此这里断言可观察的行为：补齐发生时
 * virtuosoRef 收到尾部定位指令。
 */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMessageFeedScrollModel } from "./useMessageFeedScrollModel";

interface ScrollCall {
	readonly index: unknown;
	readonly align: unknown;
}

function stubDom() {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callback(0);
		return 1;
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("会话切换后的初始视口（#7）", () => {
	it("空列表挂载 → 历史补齐：virtuoso 被要求滚动到尾部", () => {
		stubDom();
		const calls: ScrollCall[] = [];
		const { result, rerender } = renderHook(
			({ list }: { list: readonly { id: string }[] }) =>
				useMessageFeedScrollModel({ active: false, items: list, resetKey: "session-a" }),
			{ initialProps: { list: [] as readonly { id: string }[] } },
		);

		// 注入一个记录调用的 virtuoso handle（等价宿主挂载后的 ref）
		result.current.virtuosoRef.current = {
			scrollToIndex: (location: ScrollCall) => calls.push(location),
		} as unknown as NonNullable<typeof result.current.virtuosoRef.current>;

		rerender({ list: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] });

		expect(calls).toEqual([{ index: "LAST", align: "end", behavior: "auto" }]);
	});

	it("切换会话（resetKey 变化）后历史补齐：同样滚动到新会话尾部", () => {
		stubDom();
		const calls: ScrollCall[] = [];
		const { result, rerender } = renderHook(
			({ list, key }: { list: readonly { id: string }[]; key: string }) =>
				useMessageFeedScrollModel({ active: false, items: list, resetKey: key }),
			{ initialProps: { list: [{ id: "old" }], key: "session-a" } },
		);
		result.current.virtuosoRef.current = {
			scrollToIndex: (location: ScrollCall) => calls.push(location),
		} as unknown as NonNullable<typeof result.current.virtuosoRef.current>;

		rerender({ list: [], key: "session-b" });
		rerender({ list: [{ id: "x1" }, { id: "x2" }], key: "session-b" });

		expect(calls).toEqual([{ index: "LAST", align: "end", behavior: "auto" }]);
	});

	it("历史直接到达（无空列表帧）：不发尾部定位指令（回归保护）", () => {
		stubDom();
		const calls: ScrollCall[] = [];
		const { result } = renderHook(() =>
			useMessageFeedScrollModel({
				active: false,
				items: [{ id: "y1" }, { id: "y2" }],
				resetKey: "session-c",
			}),
		);
		result.current.virtuosoRef.current = {
			scrollToIndex: (location: ScrollCall) => calls.push(location),
		} as unknown as NonNullable<typeof result.current.virtuosoRef.current>;

		expect(calls).toEqual([]);
		expect(result.current.initialTopMostItemIndex).toEqual({ index: "LAST", align: "end" });
	});
});
