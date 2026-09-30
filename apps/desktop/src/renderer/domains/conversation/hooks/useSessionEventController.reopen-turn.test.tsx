// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { activeSessionStreamingAtom, chatMessagesAtom, conversationFeedAtom, createConversationFeedState } from "@shared/store/atoms";
import type { AssistantMessage } from "@vetta/ai";
import type { HistoryEntry, SessionEvent } from "@vetta/runtime-core";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullHistoryToChat, setChatStreamOwner } from "../services/chat-service";
import { dispatchConversationFeed } from "../services/conversation-feed-store";
import { useSessionEventController } from "./useSessionEventController";

const base = {
	schemaVersion: 1 as const,
	channel: "runtime" as const,
	sessionId: "session-1",
	eventId: "event-1",
	source: "agent" as const,
};

const turnId = "turn-1";

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "toolUse",
		timestamp: 2_000,
	} as unknown as AssistantMessage;
}

describe("reopening a session while its Turn is still running", () => {
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

	it("keeps streaming into the restored assistant bubble instead of opening a second one", () => {
		// The user message inside the Turn advances the history segment to 1.
		const history: HistoryEntry[] = [
			{
				type: "message",
				entryId: "user-1",
				messageId: "user-1",
				turnId,
				message: { role: "user", content: [{ type: "text", text: "go" }], timestamp: 1_000 },
			},
			{ type: "message", entryId: "a-1", messageId: "a-1", turnId, message: assistant("first") },
		];
		const { result } = renderHook(() =>
			useSessionEventController({
				activeSessionRef: { current: { runtimeId: "session-1", cwd: "/w", sessionPath: "/s.jsonl" } },
			}),
		);
		// Mirror useSessionOpener: apply the attach snapshot, then the Turn replayed from its start.
		act(() => {
			result.current.resetEventBuffers();
			dispatchConversationFeed({
				type: "feed.attached",
				runtimeId: "session-1",
				items: fullHistoryToChat(history),
				revision: 1,
				runningTurnId: turnId,
			});
		});
		const send = (event: SessionEvent) => act(() => result.current.createSessionEventHandler("session-1")(event));
		send({ ...base, type: "conversation.turn.started", turnId, timestamp: 1_000 });
		send({
			...base,
			type: "conversation.message.appended",
			turnId,
			messageId: "user-1",
			message: { role: "user", content: [{ type: "text", text: "go" }], timestamp: 1_000 },
			timestamp: 1_000,
		});
		send({
			...base,
			channel: "assistant",
			type: "text_delta",
			turnId,
			modelCallIndex: 1,
			contentIndex: 0,
			delta: "first",
			partial: assistant("first"),
			timestamp: 2_000,
		});

		send({
			...base,
			type: "conversation.message.appended",
			turnId,
			messageId: "a-2",
			message: assistant("second"),
			timestamp: 3_000,
		});
		send({ ...base, type: "model.request.started", turnId, modelCallIndex: 2, timestamp: 3_100 });
		const partial = assistant("third");
		send({
			...base,
			channel: "assistant",
			type: "text_delta",
			turnId,
			modelCallIndex: 2,
			contentIndex: 0,
			delta: "third",
			partial,
			timestamp: 3_200,
		});
		act(() => vi.advanceTimersByTime(100));

		const agents = store.get(chatMessagesAtom).filter((item) => item.kind === "agent");
		expect(agents).toHaveLength(1);
		expect(agents[0]?.text).toBe("firstthird");
	});
});
