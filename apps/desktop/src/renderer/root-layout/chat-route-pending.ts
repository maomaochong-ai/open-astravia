export interface ChatRoutePendingState {
	hasActiveSession: boolean;
	hasDefaultConversation: boolean;
	hasPendingSessionCreation: boolean;
	hasPendingSessionOpen: boolean;
	isChatRoute: boolean;
	sessionRestoreComplete: boolean;
}

/**
 * Keep the empty chat route gated until restoration or its new-session redirect finishes. A staged create/open
 * already owns its own meaningful ChatView loading state and must keep the
 * outlet mounted so optimistic or preview history can paint.
 */
export function shouldShowChatRoutePending(state: ChatRoutePendingState): boolean {
	return (
		state.isChatRoute && !state.hasActiveSession && !state.hasPendingSessionCreation && !state.hasPendingSessionOpen
	);
}
