import type { ConversationParticipantViewModel } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { createContext, type ReactNode, useContext } from "react";

/** The message a template is rendering, with what the row knows about its place in the list. */
export interface ConversationMessageRow {
	readonly message: ChatConversationItem;
	readonly index: number;
	readonly isTail: boolean;
	readonly isLastUserMessage: boolean;
	/** Author of an agent message when the conversation has named participants. */
	readonly participant?: ConversationParticipantViewModel;
}

const MessageRowContext = createContext<ConversationMessageRow | null>(null);

export function ConversationMessageScope({
	row,
	children,
}: {
	readonly row: ConversationMessageRow;
	readonly children: ReactNode;
}) {
	return <MessageRowContext.Provider value={row}>{children}</MessageRowContext.Provider>;
}

export function useMessageRow(part = "Message part"): ConversationMessageRow {
	const row = useContext(MessageRowContext);
	if (!row) throw new Error(`${part} must be rendered inside a <Conversation.Messages> message template`);
	return row;
}

export function useMessage(part?: string): ChatConversationItem {
	return useMessageRow(part).message;
}
