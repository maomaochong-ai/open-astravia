import { activeSessionStreamingAtom, retryProgressAtom } from "@shared/store/atoms";
import type { SessionEvent } from "@vetta/runtime-core";
import { useSetAtom } from "jotai";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { fullHistoryToChat, getChatStreamOwner } from "../services/chat-service";
import type { ConversationFeedAction } from "../services/conversation-feed";
import { dispatchConversationFeed, nextConversationHistoryRevision } from "../services/conversation-feed-store";
import { routeSessionEvent } from "./session-event-routes";
import type { ActiveSessionHandle } from "./session-manager-types";
import { usePromptPrediction } from "./usePromptPrediction";
import { useSessionStateEvents } from "./useSessionStateEvents";

const DELTA_FLUSH_INTERVAL_MS = 100;
// Keep a 100ms ceiling rather than rAF: markdown re-parse of the live tail is the
// expensive work, and a 120Hz display would otherwise commit ~2× more parses.

export interface SessionEventController {
	bumpSuggestionToken: (runtimeId: string) => void;
	createSessionEventHandler: (runtimeId: string) => (event: SessionEvent) => void;
	resetEventBuffers: () => void;
	/** Queue this Runtime's feed writes, in order, until its attach snapshot is applied. */
	holdFeedWrites: (runtimeId: string) => void;
	releaseFeedWrites: (runtimeId: string) => void;
}

interface SessionEventControllerOptions {
	activeSessionRef: MutableRefObject<ActiveSessionHandle | null>;
}

/** High-frequency stream fragments are batched; everything else is applied in order immediately. */
function isDeferrableFeedEvent(event: SessionEvent): boolean {
	return (
		event.channel === "assistant" &&
		(event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta")
	);
}

/**
 * Routes one active session's Runtime events: message list events to the
 * conversation feed (batched), session-wide state to its atoms, and Turn
 * lifecycle facts to streaming state, history sync and prompt prediction.
 */
export function useSessionEventController({ activeSessionRef }: SessionEventControllerOptions): SessionEventController {
	const setActiveSessionStreaming = useSetAtom(activeSessionStreamingAtom);
	const setRetryProgress = useSetAtom(retryProgressAtom);
	const { bumpSuggestionToken, predictNextPrompts } = usePromptPrediction(activeSessionRef);
	const pendingFeedEventsRef = useRef<{ runtimeId: string; events: SessionEvent[] } | null>(null);
	const flushTimerRef = useRef<number | null>(null);
	const heldWritesRef = useRef<{ runtimeId: string; actions: ConversationFeedAction[] } | null>(null);
	const activeTurnIdRef = useRef<string | null>(null);

	const writeFeed = useCallback((action: ConversationFeedAction & { readonly runtimeId: string }) => {
		const held = heldWritesRef.current;
		if (held?.runtimeId === action.runtimeId) {
			held.actions.push(action);
			return;
		}
		dispatchConversationFeed(action);
	}, []);

	const flushFeedEvents = useCallback(() => {
		if (flushTimerRef.current !== null) {
			window.clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		const pending = pendingFeedEventsRef.current;
		pendingFeedEventsRef.current = null;
		if (!pending || pending.events.length === 0) return;
		// The feed only accepts events of the Runtime it is bound to, so a stale
		// subscription cannot write into the session now on screen.
		writeFeed({ type: "runtime.events", runtimeId: pending.runtimeId, events: pending.events });
	}, [writeFeed]);

	const enqueueFeedEvent = useCallback(
		(runtimeId: string, event: SessionEvent) => {
			if (pendingFeedEventsRef.current && pendingFeedEventsRef.current.runtimeId !== runtimeId) flushFeedEvents();
			const pending = pendingFeedEventsRef.current ?? { runtimeId, events: [] };
			pending.events.push(event);
			pendingFeedEventsRef.current = pending;
			if (!isDeferrableFeedEvent(event)) {
				flushFeedEvents();
			} else if (flushTimerRef.current === null) {
				flushTimerRef.current = window.setTimeout(flushFeedEvents, DELTA_FLUSH_INTERVAL_MS);
			}
		},
		[flushFeedEvents],
	);

	const resetEventBuffers = useCallback(() => {
		if (flushTimerRef.current !== null) {
			window.clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		pendingFeedEventsRef.current = null;
		heldWritesRef.current = null;
		activeTurnIdRef.current = null;
	}, []);

	useEffect(() => resetEventBuffers, [resetEventBuffers]);

	const holdFeedWrites = useCallback(
		(runtimeId: string) => {
			flushFeedEvents();
			heldWritesRef.current = { runtimeId, actions: [] };
		},
		[flushFeedEvents],
	);

	const releaseFeedWrites = useCallback(
		(runtimeId: string) => {
			if (heldWritesRef.current?.runtimeId !== runtimeId) return;
			flushFeedEvents();
			const held = heldWritesRef.current;
			heldWritesRef.current = null;
			for (const action of held.actions) dispatchConversationFeed(action);
		},
		[flushFeedEvents],
	);

	/** Durable history supplies entry ids, branches and timing that live events do not carry. */
	const syncDurableHistory = useCallback(
		(runtimeId: string, context: string) => {
			const revision = nextConversationHistoryRevision();
			void window.vetta.session
				.getFullHistory(runtimeId)
				.then((history) => {
					writeFeed({ type: "history.loaded", runtimeId, items: fullHistoryToChat(history), revision });
				})
				.catch((error) => {
					console.warn(`[useSessionManager] history refresh after ${context} failed`, error);
				});
		},
		[writeFeed],
	);

	const applySessionStateEvent = useSessionStateEvents({ activeSessionRef, syncDurableHistory });

	const applyTurnLifecycle = useCallback(
		(runtimeId: string, event: SessionEvent) => {
			if (event.channel === "assistant") return;
			switch (event.type) {
				case "conversation.turn.started":
					// 新一轮开始：让上一轮的输入预测生成（若仍在飞）回填时作废。
					bumpSuggestionToken(runtimeId);
					activeTurnIdRef.current = event.turnId;
					setActiveSessionStreaming(true);
					return;
				case "conversation.turn.completed":
				case "conversation.turn.cancelled":
				case "conversation.turn.failed":
					setRetryProgress(null);
					// Only the running Turn's terminal fact ends streaming; a late one for an older Turn does not.
					if (activeTurnIdRef.current === null || activeTurnIdRef.current === event.turnId) {
						activeTurnIdRef.current = null;
						setActiveSessionStreaming(false);
					}
					syncDurableHistory(runtimeId, "Turn terminal");
					if (event.type === "conversation.turn.completed") predictNextPrompts(runtimeId);
					return;
				case "error":
					setRetryProgress(null);
					return;
				default:
					return;
			}
		},
		[bumpSuggestionToken, predictNextPrompts, setActiveSessionStreaming, setRetryProgress, syncDurableHistory],
	);

	const createSessionEventHandler = useCallback(
		(sessionId: string) => (event: SessionEvent) => {
			// Session-wide atoms hold only the session on screen: drop events once the user has
			// switched away. activeSessionRef is this instance's last opened session; the module
			// level owner is cleared the moment any openSession starts.
			if (activeSessionRef.current?.runtimeId !== sessionId) return;
			if (getChatStreamOwner() !== sessionId) return;
			switch (routeSessionEvent(event)) {
				case "conversation-feed":
					enqueueFeedEvent(sessionId, event);
					applyTurnLifecycle(sessionId, event);
					return;
				case "session-state":
					applySessionStateEvent(sessionId, event);
					return;
				case "ignored":
					return;
			}
		},
		[activeSessionRef, applySessionStateEvent, applyTurnLifecycle, enqueueFeedEvent],
	);

	return { bumpSuggestionToken, createSessionEventHandler, resetEventBuffers, holdFeedWrites, releaseFeedWrites };
}
