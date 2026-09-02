export interface MessageFeedNavigationEntry {
	readonly id: string;
	readonly itemIndex: number;
	readonly preview: string;
	readonly role: "response" | "request";
	readonly searchText: string;
	readonly turnNumber: number;
}

export interface MessageFeedNavigationTurn {
	readonly entries: readonly MessageFeedNavigationEntry[];
	readonly id: string;
	readonly turnNumber: number;
}

export interface MessageFeedNavigationOutlineItem {
	readonly id: string;
	readonly matchPreview: string | null;
	readonly preview: string;
	readonly targetItemIndex: number;
	readonly turnNumber: number;
}

export interface MessageFeedNavigationLabels {
	readonly open: string;
	readonly title: string;
	readonly count: (count: number) => string;
	readonly noResults: string;
	readonly close: string;
	readonly searchPlaceholder: string;
	readonly searchLabel: string;
	readonly jumpTo: (preview: string) => string;
	readonly emptyRequest: string;
}

function compactText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function createMessageFeedNavigationText(
	text: string,
	previewMaxCharacters = 120,
): { readonly preview: string; readonly searchText: string } {
	const compact = compactText(text);
	const characters = Array.from(compact);
	const preview =
		characters.length <= previewMaxCharacters
			? compact
			: `${characters.slice(0, Math.max(0, previewMaxCharacters - 1)).join("")}…`;
	return { preview, searchText: compact.toLocaleLowerCase() };
}

function headlineEntry(turn: MessageFeedNavigationTurn): MessageFeedNavigationEntry | undefined {
	return turn.entries.find((entry) => entry.role === "request") ?? turn.entries[0];
}

export function buildMessageFeedNavigationOutline(
	turns: readonly MessageFeedNavigationTurn[],
	query: string,
): MessageFeedNavigationOutlineItem[] {
	const normalized = compactText(query).toLocaleLowerCase();
	const items: MessageFeedNavigationOutlineItem[] = [];
	for (const turn of turns) {
		const headline = headlineEntry(turn);
		if (!headline) continue;
		const match = normalized ? turn.entries.find((entry) => entry.searchText.includes(normalized)) : headline;
		if (!match) continue;
		items.push({
			id: turn.id,
			matchPreview: match.id === headline.id || match.preview === headline.preview ? null : match.preview,
			preview: headline.preview,
			targetItemIndex: match.itemIndex,
			turnNumber: turn.turnNumber,
		});
	}
	return items;
}

export function findActiveMessageFeedNavigationTurnIndex(
	turns: readonly MessageFeedNavigationTurn[],
	itemIndex: number,
): number {
	let activeIndex = 0;
	for (let index = 0; index < turns.length; index++) {
		const firstItemIndex = turns[index]?.entries[0]?.itemIndex;
		if (firstItemIndex === undefined || firstItemIndex > itemIndex) break;
		activeIndex = index;
	}
	return activeIndex;
}
