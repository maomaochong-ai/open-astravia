import type { ChatMessage } from "./types";

export const MESSAGE_NAVIGATION_MIN_TURNS = 8;
const NAVIGATION_PREVIEW_MAX_CHARACTERS = 72;

export interface MessageNavigationEntry {
	id: string;
	messageIndex: number;
	preview: string;
	role: "assistant" | "user";
	searchText: string;
	turnNumber: number;
}

export interface MessageNavigationTurn {
	entries: MessageNavigationEntry[];
	id: string;
	turnNumber: number;
}

function compactText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function previewText(text: string): string {
	const compact = compactText(text);
	const characters = Array.from(compact);
	if (characters.length <= NAVIGATION_PREVIEW_MAX_CHARACTERS) return compact;
	return `${characters.slice(0, NAVIGATION_PREVIEW_MAX_CHARACTERS - 1).join("")}…`;
}

function visibleMessageText(message: ChatMessage): string {
	if (message.text.trim()) return message.text;
	return (
		message.blocks
			?.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n") ?? ""
	);
}

export function buildMessageNavigationTurns(messages: ChatMessage[]): MessageNavigationTurn[] {
	const turns: MessageNavigationTurn[] = [];
	let current: MessageNavigationTurn | undefined;

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

		const text = compactText(visibleMessageText(message));
		current.entries.push({
			id: message.id,
			messageIndex,
			preview: previewText(text),
			role: message.role,
			searchText: text.toLocaleLowerCase(),
			turnNumber: current.turnNumber,
		});
	}

	return turns;
}

export function filterMessageNavigationTurns(turns: MessageNavigationTurn[], query: string): MessageNavigationTurn[] {
	const normalized = compactText(query).toLocaleLowerCase();
	if (!normalized) return turns;
	return turns.filter((turn) => turn.entries.some((entry) => entry.searchText.includes(normalized)));
}

export function findActiveNavigationTurnIndex(turns: MessageNavigationTurn[], messageIndex: number): number {
	let activeIndex = 0;
	for (let index = 0; index < turns.length; index++) {
		const firstMessageIndex = turns[index].entries[0]?.messageIndex;
		if (firstMessageIndex === undefined || firstMessageIndex > messageIndex) break;
		activeIndex = index;
	}
	return activeIndex;
}
