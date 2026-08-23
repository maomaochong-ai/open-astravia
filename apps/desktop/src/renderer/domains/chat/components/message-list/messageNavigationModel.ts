import type { ChatMessage } from "./types";

export const MESSAGE_NAVIGATION_MIN_TURNS = 8;
const NAVIGATION_PREVIEW_MAX_CHARACTERS = 120;

export function shouldShowMessageNavigation(messages: readonly ChatMessage[]): boolean {
	let turns = 0;
	let current = false;
	for (const message of messages) {
		if (message.role === "compaction") continue;
		if (message.role === "user" || !current) {
			turns += 1;
			current = true;
			if (turns >= MESSAGE_NAVIGATION_MIN_TURNS) return true;
		}
	}
	return false;
}

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

export interface MessageNavigationOutlineItem {
	id: string;
	matchPreview: string | null;
	preview: string;
	targetMessageIndex: number;
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

function headlineEntry(turn: MessageNavigationTurn): MessageNavigationEntry | undefined {
	return turn.entries.find((entry) => entry.role === "user") ?? turn.entries[0];
}

export function buildMessageNavigationOutline(
	turns: MessageNavigationTurn[],
	query: string,
): MessageNavigationOutlineItem[] {
	const normalized = compactText(query).toLocaleLowerCase();
	const items: MessageNavigationOutlineItem[] = [];
	for (const turn of turns) {
		const headline = headlineEntry(turn);
		if (!headline) continue;
		const match = normalized ? turn.entries.find((entry) => entry.searchText.includes(normalized)) : headline;
		if (!match) continue;
		items.push({
			id: turn.id,
			matchPreview: match.id === headline.id || match.preview === headline.preview ? null : match.preview,
			preview: headline.preview,
			targetMessageIndex: match.messageIndex,
			turnNumber: turn.turnNumber,
		});
	}
	return items;
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
