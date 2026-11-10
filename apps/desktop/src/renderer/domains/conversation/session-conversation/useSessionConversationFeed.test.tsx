// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { activeSessionAtom } from "@shared/store/chat-atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { useSessionConversationFeed } from "./useSessionConversationFeed";

const workspace = createActivityWorkspace("conversation:/tmp/s.jsonl", "/tmp");

function wrapper(store: ReturnType<typeof createStore>) {
	return ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
}

/**
 * 回归：`abort` 是上游传进来的 props 回调，必须原样出现在 feed 能力里。
 * 丢了它，流式进行中删除或改写上一条消息就停不下当前回合——按钮点了没反应。
 */
describe("useSessionConversationFeed capabilities", () => {
	it("把传入的 abort 透传给 feed 能力", () => {
		const store = createStore();
		store.set(activeSessionAtom, { cwd: "/tmp", sessionPath: "/tmp/s.jsonl", runtimeId: "rt-1" });
		const abort = vi.fn();
		const { result } = renderHook(
			() => useSessionConversationFeed({ key: "/tmp/s.jsonl", workspace, abort }),
			{ wrapper: wrapper(store) },
		);
		expect(result.current.capabilities.abort).toBe(abort);
		result.current.capabilities.abort?.();
		expect(abort).toHaveBeenCalledTimes(1);
	});

	it("没有 abort 时不伪造这个能力", () => {
		const store = createStore();
		store.set(activeSessionAtom, { cwd: "/tmp", sessionPath: "/tmp/s.jsonl", runtimeId: "rt-1" });
		const { result } = renderHook(() => useSessionConversationFeed({ key: "/tmp/s.jsonl", workspace }), {
			wrapper: wrapper(store),
		});
		expect(result.current.capabilities.abort).toBeUndefined();
	});

	it("当前展示的会话才拿到续写能力", () => {
		const store = createStore();
		store.set(activeSessionAtom, { cwd: "/tmp", sessionPath: "/tmp/s.jsonl", runtimeId: "rt-1" });
		const current = renderHook(() => useSessionConversationFeed({ key: "/tmp/s.jsonl", workspace }), {
			wrapper: wrapper(store),
		});
		const other = renderHook(() => useSessionConversationFeed({ key: "/tmp/other.jsonl", workspace }), {
			wrapper: wrapper(store),
		});
		expect(typeof current.result.current.capabilities.resumeInterruptedTurn).toBe("function");
		expect(other.result.current.capabilities.resumeInterruptedTurn).toBeUndefined();
		expect(other.result.current.capabilities.subagentRuntimeId).toBeUndefined();
	});
});
