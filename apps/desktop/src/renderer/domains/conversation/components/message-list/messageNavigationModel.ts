import {
	createMessageFeedNavigationText,
	type MessageFeedNavigationEntry,
	type MessageFeedNavigationTurn,
} from "@shared/components/message-feed/navigationModel";
import type { ChatConversationItem } from "./types";

export type { RenderedFeedItem as RenderedMessageItem } from "@shared/components/message-feed/visibleItemModel";
export { findTopVisibleItemIndex as findTopVisibleMessageIndex } from "@shared/components/message-feed/visibleItemModel";

export const MESSAGE_NAVIGATION_MIN_TURNS = 8;

function visibleMessageText(message: ChatConversationItem): string {
	if (message.kind === "event") return "";
	if (message.text?.trim()) return message.text;
	if (message.kind === "user") return message.text;
	return message.blocks
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/** Chat adapter: projects the domain message schema into the shared navigation contract. */
export function buildMessageNavigationTurns(messages: ChatConversationItem[]): MessageFeedNavigationTurn[] {
	const turns: Array<{
		id: string;
		turnNumber: number;
		entries: MessageFeedNavigationEntry[];
	}> = [];
	let current: (typeof turns)[number] | undefined;

	for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
		const message = messages[messageIndex];
		if (message.kind === "event") continue;

		if (message.kind === "user" || !current) {
			current = {
				id: `turn-${message.id}`,
				turnNumber: turns.length + 1,
				entries: [],
			};
			turns.push(current);
		}

		const navigationText = createMessageFeedNavigationText(visibleMessageText(message));
		current.entries.push({
			id: message.id,
			itemIndex: messageIndex,
			preview: navigationText.preview,
			role: message.kind === "user" ? "request" : "response",
			searchText: navigationText.searchText,
			turnNumber: current.turnNumber,
		});
	}

	return turns;
}
