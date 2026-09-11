// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { chatMessagesAtom, contextUsageAtom, isCompactingAtom } from "@shared/store/atoms";
import { messageQueueBySessionAtom } from "@shared/store/message-queue-atoms";
import { dismissToast, toastsAtom } from "@shared/store/toast-atoms";
import type { ContextCompositionReport, SessionEvent } from "@vetta/runtime-core";
import { createStore, getDefaultStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { setChatStreamOwner } from "../services/chat-service";
import { useSessionEventController } from "./useSessionEventController";

describe("useSessionEventController compaction events", () => {
	it("压缩队列条目被执行时不会生成用户消息气泡", () => {
		const store = getDefaultStore();
		setChatStreamOwner("session-1");
		store.set(chatMessagesAtom, []);
		store.set(
			messageQueueBySessionAtom,
			new Map([
				[
					"session-1",
					[{ id: "compact-1", displayText: "context.compact", behavior: "followUp", kind: "context_compaction" }],
				],
			]),
		);
		const activeSessionRef = {
			current: { runtimeId: "session-1", cwd: "C:/workspace", sessionPath: "C:/sessions/session-1.jsonl" },
		};
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
		const { result } = renderHook(() => useSessionEventController({ activeSessionRef }), { wrapper });

		act(() =>
			result.current.createSessionEventHandler("session-1")({
				schemaVersion: 1,
				channel: "runtime",
				type: "queue.changed",
				sessionId: "session-1",
				eventId: "event-queue",
				timestamp: 1,
				source: "runtime-core",
				paused: false,
				entries: [],
				snapshot: {},
			}),
		);

		expect(store.get(chatMessagesAtom)).toEqual([]);
		expect(store.get(messageQueueBySessionAtom).get("session-1")).toBeUndefined();
	});

	it("replaces stale usage and composition when compaction succeeds", () => {
		const store = createStore();
		// 事件闸门以模块级「消息流归属」为准（见 chat-service.setChatStreamOwner）：
		// 直接驱动 controller 的单测必须先声明当前会话拥有消息流。
		setChatStreamOwner("session-1");
		store.set(isCompactingAtom, true);
		store.set(contextUsageAtom, {
			percent: 91,
			contextTokens: 91_000,
			contextWindow: 100_000,
			composition: composition(),
		});
		const activeSessionRef = {
			current: { runtimeId: "session-1", cwd: "C:/workspace", sessionPath: "C:/sessions/session-1.jsonl" },
		};
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
		const { result } = renderHook(() => useSessionEventController({ activeSessionRef }), { wrapper });
		const event: SessionEvent = {
			schemaVersion: 1,
			channel: "runtime",
			type: "compaction.end",
			sessionId: "session-1",
			eventId: "event-1",
			timestamp: 1,
			source: "runtime-core",
			success: true,
			reason: "threshold",
			tokensBefore: 91_000,
			contextPercent: 24,
			contextTokens: 24_000,
			contextWindow: 100_000,
		};

		act(() => result.current.createSessionEventHandler("session-1")(event));

		expect(store.get(isCompactingAtom)).toBe(false);
		expect(store.get(contextUsageAtom)).toEqual({
			percent: 24,
			contextTokens: 24_000,
			contextWindow: 100_000,
		});
	});

	it("手动压缩失败时显示可恢复的错误提示", () => {
		const store = getDefaultStore();
		setChatStreamOwner("session-1");
		store.set(toastsAtom, []);
		const activeSessionRef = {
			current: { runtimeId: "session-1", cwd: "C:/workspace", sessionPath: "C:/sessions/session-1.jsonl" },
		};
		const { result } = renderHook(() => useSessionEventController({ activeSessionRef }));

		act(() =>
			result.current.createSessionEventHandler("session-1")({
				schemaVersion: 1,
				channel: "runtime",
				type: "compaction.end",
				sessionId: "session-1",
				eventId: "event-failed",
				timestamp: 1,
				source: "runtime-core",
				success: false,
				reason: "manual",
				errorMessage: "摘要服务暂时不可用",
			}),
		);

		const toast = store.get(toastsAtom).at(-1);
		expect(toast).toMatchObject({ variant: "error", message: "摘要服务暂时不可用" });
		if (toast) dismissToast(toast.id);
	});
});

function composition(): ContextCompositionReport {
	return {
		version: 1,
		callId: "before-compaction",
		snapshotId: "snapshot-1",
		phase: "completed",
		createdAt: 1,
		model: { provider: "test", modelId: "test-model", contextWindow: 100_000 },
		estimate: { tokens: 91_000, knownTokens: 91_000, coverage: "complete" },
		sections: [],
	};
}
