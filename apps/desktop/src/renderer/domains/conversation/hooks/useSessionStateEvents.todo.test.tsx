// @vitest-environment jsdom

import type { SessionEvent } from "@astravia/runtime-core";
import { todoItemsBySessionAtom } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/i18n", () => ({ i18n: { t: (key: string) => key } }));

const { useSessionStateEvents } = await import("./useSessionStateEvents");
const { getTodoItemsForSession } = await import("@shared/store/atoms");

function todoEvent(payload: readonly { id: number; content: string; status: string }[]): SessionEvent {
	return {
		channel: "runtime",
		event: "changed",
		eventId: `evt-${payload.length}`,
		extensionId: "coding-agent.todo",
		payload,
		schemaVersion: 1,
		sessionId: "session-1",
		timestamp: 1,
		type: "session.extension",
	} as unknown as SessionEvent;
}

function renderDispatcher() {
	const activeSessionRef = { current: null };
	const syncDurableHistory = vi.fn();
	const { result } = renderHook(() => useSessionStateEvents({ activeSessionRef, syncDurableHistory }));
	return result.current;
}

describe("useSessionStateEvents todo observation", () => {
	beforeEach(() => {
		getDefaultStore().set(todoItemsBySessionAtom, new Map());
	});

	it("stores the checklist the moment the agent reports it, then reflects completed work", () => {
		const dispatch = renderDispatcher();

		dispatch("session-1", todoEvent([{ id: 1, content: "定位卡顿", status: "in_progress" }]));
		expect(getTodoItemsForSession(getDefaultStore().get(todoItemsBySessionAtom), "session-1")).toEqual([
			{ id: 1, content: "定位卡顿", status: "in_progress" },
		]);

		// 运行中完成一项：同一会话的下一次观察必须替换旧清单，而不是被忽略。
		dispatch(
			"session-1",
			todoEvent([
				{ id: 1, content: "定位卡顿", status: "done" },
				{ id: 2, content: "修复渲染", status: "in_progress" },
			]),
		);
		expect(getTodoItemsForSession(getDefaultStore().get(todoItemsBySessionAtom), "session-1")).toEqual([
			{ id: 1, content: "定位卡顿", status: "done" },
			{ id: 2, content: "修复渲染", status: "in_progress" },
		]);
	});

	it("clears the checklist when the agent reports no remaining items", () => {
		const dispatch = renderDispatcher();
		dispatch("session-1", todoEvent([{ id: 1, content: "定位卡顿", status: "done" }]));
		dispatch("session-1", todoEvent([]));

		expect(getTodoItemsForSession(getDefaultStore().get(todoItemsBySessionAtom), "session-1")).toEqual([]);
	});
});
