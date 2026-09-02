import {
	createMessageFeedNavigationText,
	type MessageFeedNavigationEntry,
	type MessageFeedNavigationTurn,
} from "@shared/components/message-feed/navigationModel";
import type { ChatMessage } from "./types";

export type { RenderedFeedItem as RenderedMessageItem } from "@shared/components/message-feed/visibleItemModel";
export { findTopVisibleItemIndex as findTopVisibleMessageIndex } from "@shared/components/message-feed/visibleItemModel";

export const MESSAGE_NAVIGATION_MIN_TURNS = 8;

function visibleMessageText(message: ChatMessage): string {
	if (message.text.trim()) return message.text;
	return (
		message.blocks
			?.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n") ?? ""
	);
}

/** Chat adapter: projects the domain message schema into the shared navigation contract. */
export function buildMessageNavigationTurns(messages: ChatMessage[]): MessageFeedNavigationTurn[] {
	const turns: Array<{
		id: string;
		turnNumber: number;
		entries: MessageFeedNavigationEntry[];
	}> = [];
	let current: (typeof turns)[number] | undefined;

	for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
		const message = messages[messageIndex];
		if (message.role === "compaction") continue;

		if (message.role === "user" || !current) {
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
			role: message.role === "user" ? "request" : "response",
			searchText: navigationText.searchText,
			turnNumber: current.turnNumber,
		});
	}

	return turns;
}
