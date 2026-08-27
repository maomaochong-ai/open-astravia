import { parseInputSegments, segmentsToText } from "@shared/lib/input-tokens";

export type ClipboardInsertionPart = { kind: "text"; text: string } | { kind: "image"; path: string };

function pushText(parts: ClipboardInsertionPart[], text: string): void {
	if (!text) return;
	const previous = parts.at(-1);
	// insertImageToken always adds one trailing space. The serialized message text
	// also has a token boundary space, so consume that copy to avoid doubling it.
	const normalizedText = previous?.kind === "image" && text.startsWith(" ") ? text.slice(1) : text;
	if (!normalizedText) return;
	if (previous?.kind === "text") {
		previous.text += normalizedText;
		return;
	}
	parts.push({ kind: "text", text: normalizedText });
}

/** Replace copied attachment paths with the newly persisted paths while preserving token order. */
export function createClipboardInsertionParts(
	clipboardText: string,
	imagePaths: readonly string[],
): ClipboardInsertionPart[] {
	const { segments } = parseInputSegments(clipboardText);
	const parts: ClipboardInsertionPart[] = [];
	let imageIndex = 0;
	for (const segment of segments) {
		if (segment.kind === "image") {
			const path = imagePaths[imageIndex++];
			if (path) parts.push({ kind: "image", path });
			continue;
		}
		pushText(parts, segmentsToText([segment]));
	}
	for (; imageIndex < imagePaths.length; imageIndex++) {
		const path = imagePaths[imageIndex];
		if (path) parts.push({ kind: "image", path });
	}
	return parts;
}
