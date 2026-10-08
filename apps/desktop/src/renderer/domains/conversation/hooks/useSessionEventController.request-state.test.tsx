// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createConversationUserMessage } from "@shared/conversation";
import {
	activeSessionStreamingAtom,
	chatMessagesAtom,
	conversationFeedAtom,
	createConversationFeedState,
} from "@shared/store/atoms";
import type { AssistantMessage } from "@vetta/ai";
import type { SessionEvent } from "@vetta/runtime-core";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setChatStreamOwner } from "../services/chat-service";
import { dispatchConversationFeed } from "../services/conversation-feed-store";
import { useSessionEventController } from "./useSessionEventController";

const base = {
	schemaVersion: 1 as const,
	channel: "runtime" as const,
	sessionId: "session-1",
	eventId: "event-1",
	source: "agent" as const,
};

describe("conversation request preparation", () => {
	const store = getDefaultStore();
	beforeEach(() => {
		vi.useFakeTimers();
		setChatStreamOwner("session-1");
		store.set(conversationFeedAtom, createConversationFeedState("session-1"));
		store.set(activeSessionStreamingAtom, false);
		vi.stubGlobal("vetta", {
			session: { getFullHistory: () => new Promise(() => undefined) },
			config: { get: async () => ({ experimental: { promptPrediction: false } }) },
		});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("preserves preparation time, switches on the actual request, receives output and resets on the next send", () => {
		dispatchConversationFeed({
			type: "user.sent",
			message: createConversationUserMessage({ id: "user-1", text: "hello", timestamp: 1_000 }),
		});
		dispatchConversationFeed({ type: "turn.pending", startedAt: 1_000 });
		const { result } = renderHook(() =>
			useSessionEventController({
				activeSessionRef: {
					current: { runtimeId: "session-1", cwd: "C:/workspace", sessionPath: "C:/session.jsonl" },
				},
			}),
		);
		const send = (event: SessionEvent) => act(() => result.current.createSessionEventHandler("session-1")(event));
		const tail = () => store.get(chatMessagesAtom).at(-1);
		send({ ...base, type: "conversation.turn.started", turnId: "turn-1", timestamp: 5_000 });
		expect(store.get(activeSessionStreamingAtom)).toBe(true);
		expect(tail()).toMatchObject({ phase: "streaming", startedAt: 1_000 });
		expect(tail()).not.toHaveProperty("modelRequestStartedAt");
		send({ ...base, type: "model.request.started", turnId: "turn-1", modelCallIndex: 0, timestamp: 7_000 });
		expect(tail()).toMatchObject({ startedAt: 1_000, modelRequestStartedAt: 7_000 });
		// Duplicate delivery must not restart the visible waiting timer.
		send({ ...base, type: "model.request.started", turnId: "turn-1", modelCallIndex: 0, timestamp: 7_100 });
		const partial = {
			role: "assistant",
			content: [{ type: "text", text: "hello back" }],
		} as unknown as AssistantMessage;
		send({
			...base,
			channel: "assistant",
			type: "text_delta",
			turnId: "turn-1",
			modelCallIndex: 0,
			contentIndex: 0,
			delta: "hello back",
			partial,
			timestamp: 7_200,
		});
		act(() => vi.advanceTimersByTime(100));
		expect(tail()).toMatchObject({ text: "hello back", startedAt: 1_000, modelRequestStartedAt: 7_000 });
		send({ ...base, type: "conversation.turn.completed", turnId: "turn-1", stopReason: "stop", timestamp: 8_000 });
		expect(store.get(activeSessionStreamingAtom)).toBe(false);
		expect(tail()).toMatchObject({ endedAt: 8_000, durationSeconds: 7 });
		const completed = tail();
		send({ ...base, type: "model.request.started", turnId: "turn-1", modelCallIndex: 1, timestamp: 8_100 });
		expect(tail()).toBe(completed);

		act(() =>
			dispatchConversationFeed({
				type: "user.sent",
				message: createConversationUserMessage({ id: "user-2", text: "continue", timestamp: 9_000 }),
			}),
		);
		send({ ...base, type: "conversation.turn.started", turnId: "turn-2", timestamp: 9_000 });
		expect(tail()).toMatchObject({ phase: "streaming", startedAt: 9_000 });
		expect(tail()).not.toHaveProperty("modelRequestStartedAt");
		send({ ...base, type: "conversation.turn.cancelled", turnId: "turn-2", timestamp: 9_500 });
		expect(store.get(activeSessionStreamingAtom)).toBe(false);
		expect(tail()).toMatchObject({ phase: "aborted", endedAt: 9_500 });
	});

	it("restores a request boundary before first output and ignores another session's events", () => {
		const { result } = renderHook(() =>
			useSessionEventController({
				activeSessionRef: {
					current: { runtimeId: "session-1", cwd: "C:/workspace", sessionPath: "C:/session.jsonl" },
				},
			}),
		);
		const event: SessionEvent = {
			...base,
			type: "model.request.started",
			turnId: "turn-1",
			modelCallIndex: 0,
			timestamp: 7_000,
		};
		act(() => result.current.createSessionEventHandler("session-2")({ ...event, sessionId: "session-2" }));
		expect(store.get(chatMessagesAtom)).toEqual([]);
		act(() => result.current.createSessionEventHandler("session-1")(event));
		expect(store.get(chatMessagesAtom).at(-1)).toMatchObject({ modelRequestStartedAt: 7_000 });
	});
});
