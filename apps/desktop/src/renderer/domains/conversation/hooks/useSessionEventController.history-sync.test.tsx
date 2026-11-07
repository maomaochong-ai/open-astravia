// @vitest-environment jsdom

import type { HistoryEntry, SessionEvent } from "@astravia/runtime-core";
import { conversationFeedAtom, createConversationFeedState } from "@shared/store/atoms";
import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setChatStreamOwner } from "../services/chat-service";
import { useSessionEventController } from "./useSessionEventController";

const base = {
	schemaVersion: 1 as const,
	channel: "runtime" as const,
	sessionId: "session-1",
	source: "runtime-core" as const,
};

function turnCancelled(eventId: string, turnId: string): SessionEvent {
	return { ...base, type: "conversation.turn.cancelled", eventId, timestamp: 1, turnId } as SessionEvent;
}

/** 手动控制何时落地，才能观察两次重载是否同时在飞。 */
function createDeferredHistory() {
	const deferred: Array<(history: HistoryEntry[]) => void> = [];
	const getFullHistory = vi.fn(
		() =>
			new Promise<HistoryEntry[]>((resolve) => {
				deferred.push(resolve);
			}),
	);
	return { deferred, getFullHistory };
}

async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("useSessionEventController 全量历史重载", () => {
	const store = getDefaultStore();
	let history: ReturnType<typeof createDeferredHistory>;

	beforeEach(() => {
		setChatStreamOwner("session-1");
		store.set(conversationFeedAtom, createConversationFeedState("session-1"));
		history = createDeferredHistory();
		vi.stubGlobal("astravia", {
			session: { getFullHistory: history.getFullHistory },
			config: { get: async () => ({ experimental: { promptPrediction: false } }) },
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// 每次重载都要经 IPC 反序列化整份历史再 fullHistoryToChat 重建成列表，成本随上下文线性增长。
	// 两个 Turn 紧接着收尾时若各自发起一次，大上下文下两份构建峰值会叠在同一个渲染进程里。
	it("在飞期间再来的终态事件只在落地后再跑一次", async () => {
		const activeSessionRef = {
			current: { runtimeId: "session-1", cwd: "C:/workspace", sessionPath: "C:/sessions/session-1.jsonl" },
		};
		const { result } = renderHook(() => useSessionEventController({ activeSessionRef }));

		act(() => result.current.createSessionEventHandler("session-1")(turnCancelled("e1", "turn-1")));
		expect(history.getFullHistory).toHaveBeenCalledTimes(1);

		act(() => result.current.createSessionEventHandler("session-1")(turnCancelled("e2", "turn-2")));
		expect(history.getFullHistory).toHaveBeenCalledTimes(1);

		history.deferred[0]?.([]);
		await settle();
		expect(history.getFullHistory).toHaveBeenCalledTimes(2);

		history.deferred[1]?.([]);
		await settle();
		expect(history.getFullHistory).toHaveBeenCalledTimes(2);
	});
});
