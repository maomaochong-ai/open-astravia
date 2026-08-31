export interface SearchTextRange {
	start: number;
	end: number;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function normalizeSearchText(text: string): string {
	return canonicalSearchText(text).toLowerCase();
}

function canonicalSearchText(text: string): string {
	return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Map normalized matches back to the original graphemes, without retaining a per-character index. */
export function findSearchTextRanges(text: string, query: string, firstOnly = false): SearchTextRange[] {
	const needle = normalizeSearchText(query);
	if (!needle) return [];
	const canonical = canonicalSearchText(text);
	const normalized = canonical.toLowerCase();
	const matches: SearchTextRange[] = [];
	for (let start = normalized.indexOf(needle); start >= 0; start = normalized.indexOf(needle, start + needle.length)) {
		matches.push({ start, end: start + needle.length });
		if (firstOnly) break;
	}
	// Case-only changes normally preserve offsets. Avoid segmenting an entire long message for these hits.
	if (!matches.length || (canonical === text && normalized.length === text.length)) return matches;

	const ranges: SearchTextRange[] = [];
	let offset = 0;
	let matchIndex = 0;
	let originalStart: number | undefined;
	let space = true;
	for (const { segment, index } of graphemes.segment(text)) {
		let length = 0;
		for (const char of segment.normalize("NFKC").toLowerCase()) {
			const isSpace = /\s/.test(char);
			if (!isSpace || !space) length += isSpace ? 1 : char.length;
			space = isSpace;
		}
		const end = offset + length;
		while (matchIndex < matches.length && matches[matchIndex].start < end) {
			originalStart ??= index;
			if (matches[matchIndex].end > end) break;
			const previous = ranges.at(-1);
			const originalEnd = index + segment.length;
			// A compatibility glyph can contain several matches (e.g. two "f" hits in "ﬃ").
			if (previous && previous.end >= originalStart) previous.end = originalEnd;
			else ranges.push({ start: originalStart, end: originalEnd });
			originalStart = undefined;
			matchIndex += 1;
		}
		if (matchIndex === matches.length) break;
		offset = end;
	}
	return ranges;
}

/** Keep the first hit and nearby context, even when the query exceeds the usual preview size. */
export function createSearchSnippet(text: string, query: string): string {
	const match = findSearchTextRanges(text, query, true)[0];
	if (!match) return text.slice(0, 200);
	const width = Math.max(200, match.end - match.start + 80);
	const start = Math.max(0, Math.min(text.length - width, match.start - 40));
	const end = Math.min(text.length, start + width);
	const segments = graphemes.segment(text);
	const first = segments.containing(start)?.index ?? start;
	const last = segments.containing(end - 1);
	const lastEnd = last ? last.index + last.segment.length : end;
	return `${first > 0 ? "…" : ""}${text.slice(first, lastEnd)}${lastEnd < text.length ? "…" : ""}`;
}
