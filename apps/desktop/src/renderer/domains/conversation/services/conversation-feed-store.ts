import { conversationFeedAtom, createConversationFeedState } from "@shared/store/chat-atoms";
import { atom, getDefaultStore } from "jotai";
import {
	type ConversationFeedAction,
	type ConversationFeedOutbox,
	conversationFeedOutbox,
	reduceConversationFeed,
} from "./conversation-feed";

type JotaiStore = ReturnType<typeof getDefaultStore>;

/** Unconfirmed sends of feeds that are not shown, by Runtime. Restored when that Runtime is bound again. */
const suspendedOutboxesAtom = atom<ReadonlyMap<string, ConversationFeedOutbox>>(new Map());

let historyRevision = 0;

/** Token for a history request; the feed ignores responses older than the last one it applied. */
export function nextConversationHistoryRevision(): number {
	historyRevision += 1;
	return historyRevision;
}

export function dispatchConversationFeed(action: ConversationFeedAction, store: JotaiStore = getDefaultStore()): void {
	store.set(conversationFeedAtom, (state) => reduceConversationFeed(state, action));
}

/** Show an empty, unbound feed. Unconfirmed sends of the previous Runtime wait for it to be bound again. */
export function resetConversationFeed(store: JotaiStore = getDefaultStore()): void {
	const current = store.get(conversationFeedAtom);
	if (current.runtimeId) {
		const outbox = conversationFeedOutbox(current);
		const runtimeId = current.runtimeId;
		store.set(suspendedOutboxesAtom, (previous) => {
			const next = new Map(previous);
			if (outbox.visible.length > 0 || outbox.queued.length > 0) next.set(runtimeId, outbox);
			else next.delete(runtimeId);
			return next;
		});
	}
	store.set(conversationFeedAtom, createConversationFeedState());
}

/**
 * A send targets `runtimeId`. A feed on screen that no Runtime has claimed yet
 * belongs to that send, so its unconfirmed messages follow the Runtime when the
 * user switches away.
 */
export function claimUnboundConversationFeed(runtimeId: string, store: JotaiStore = getDefaultStore()): void {
	if (store.get(conversationFeedAtom).runtimeId === null) bindConversationFeed(runtimeId, store);
}

/** The active feed now belongs to `runtimeId`; restore the sends it had not confirmed when it was left. */
export function bindConversationFeed(runtimeId: string, store: JotaiStore = getDefaultStore()): void {
	const outbox = store.get(suspendedOutboxesAtom).get(runtimeId);
	if (outbox) {
		store.set(suspendedOutboxesAtom, (previous) => {
			const next = new Map(previous);
			next.delete(runtimeId);
			return next;
		});
	}
	dispatchConversationFeed({ type: "feed.bound", runtimeId, ...(outbox ? { outbox } : {}) }, store);
}
