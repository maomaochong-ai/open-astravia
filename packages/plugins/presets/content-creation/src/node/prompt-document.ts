import type {
	ContentNodeData,
	ContentPromptDocument,
	ContentPromptSegment,
} from "../project/types";

export function createContentPromptDocument(data: ContentNodeData): ContentPromptDocument {
	const bindingIds = (data.inputs ?? []).map(({ id }) => id);
	if (!data.promptDocument) {
		return normalizeContentPromptDocument(
			{
				version: 1,
				segments: [
					...(data.prompt ? [{ type: "text" as const, text: data.prompt }] : []),
					...bindingIds.map((bindingId) => ({ type: "asset-reference" as const, bindingId })),
				],
			},
			bindingIds,
		);
	}
	return normalizeContentPromptDocument(data.promptDocument, bindingIds);
}

export function normalizeContentPromptDocument(
	document: ContentPromptDocument,
	availableBindingIds: readonly string[],
): ContentPromptDocument {
	const available = new Set(availableBindingIds);
	const represented = new Set<string>();
	const segments = document.segments.flatMap((segment): ContentPromptSegment[] => {
		if (segment.type === "asset-reference") {
			if (!available.has(segment.bindingId)) return [];
			represented.add(segment.bindingId);
			return [segment];
		}
		return segment.text ? [segment] : [];
	});
	for (const bindingId of availableBindingIds) {
		if (represented.has(bindingId)) continue;
		segments.push({ type: "asset-reference", bindingId });
	}
	return { version: 1, segments: mergeAdjacentTextSegments(segments) };
}

export function appendContentPromptReferences(
	document: ContentPromptDocument,
	bindingIds: readonly string[],
): ContentPromptDocument {
	return normalizeContentPromptDocument(
		{
			version: 1,
			segments: [
				...document.segments,
				...bindingIds.map((bindingId) => ({ type: "asset-reference" as const, bindingId })),
			],
		},
		[
			...listContentPromptBindingIds(document),
			...bindingIds,
		],
	);
}

export function contentPromptText(document: ContentPromptDocument): string {
	return document.segments
		.flatMap((segment) => (segment.type === "text" ? [segment.text] : []))
		.join("")
		.trim();
}

export function listContentPromptBindingIds(document: ContentPromptDocument): string[] {
	const ids = document.segments.flatMap((segment) =>
		segment.type === "asset-reference" ? [segment.bindingId] : [],
	);
	return ids.filter((bindingId, index) => ids.indexOf(bindingId) === index);
}

export function contentPromptTextFromData(data: ContentNodeData): string {
	return data.promptDocument ? contentPromptText(data.promptDocument) : data.prompt?.trim() ?? "";
}

function mergeAdjacentTextSegments(segments: readonly ContentPromptSegment[]): ContentPromptSegment[] {
	const merged: ContentPromptSegment[] = [];
	for (const segment of segments) {
		const previous = merged.at(-1);
		if (segment.type === "text" && previous?.type === "text") {
			previous.text += segment.text;
		} else {
			merged.push({ ...segment });
		}
	}
	return merged;
}
