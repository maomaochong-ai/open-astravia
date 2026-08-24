export const ANCHOR_SEPARATOR = "→";
export const ANCHOR_HASH_WIDTH = 4;
export const ANCHOR_SEARCH_RADIUS = 20;

export function anchorLineHash(line: string): string {
	const normalized = line.replace(/\s+/g, "");
	let hash = 0x811c9dc5;
	for (let index = 0; index < normalized.length; index++) {
		hash ^= normalized.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36).padStart(ANCHOR_HASH_WIDTH, "0").slice(-ANCHOR_HASH_WIDTH);
}

export function renderAnchoredLines(lines: readonly string[], startLine: number): string[] {
	return lines.map((line, index) => `${startLine + index}:${anchorLineHash(line)}${ANCHOR_SEPARATOR}${line}`);
}

const ANCHOR_PREFIX_PATTERN = new RegExp(`^(?:(\\d{1,9}):)?([0-9a-z]{${ANCHOR_HASH_WIDTH}})${ANCHOR_SEPARATOR}`);

export interface AnchorPrefixStripResult {
	readonly text: string;
	readonly strippedLines: readonly number[];
}

interface AnchorPrefixClassification {
	readonly prefixLength: number;
	readonly confident: boolean;
}

function classifyAnchorPrefix(line: string, knownHashes: ReadonlySet<string>): AnchorPrefixClassification {
	const match = ANCHOR_PREFIX_PATTERN.exec(line);
	if (!match) return { prefixLength: 0, confident: false };
	const prefixLength = match[0].length;
	// A `line:hash` prefix cannot plausibly be intended file content. A bare hash is proof
	// when it hashes its own remainder, or when it is an anchor hash of the text being
	// replaced — the model copied it before rewriting that line's content.
	const confident =
		match[1] !== undefined || anchorLineHash(line.slice(prefixLength)) === match[2] || knownHashes.has(match[2]);
	return { prefixLength, confident };
}

/**
 * Removes anchor prefixes that leaked into text destined for a file. Weaker models copy the
 * `42:h7x2→` prefix out of read output into edit content, which otherwise lands verbatim in
 * the file and breaks the syntax of whatever it prefixes.
 *
 * `knownHashes` are anchor hashes the caller knows the model was shown for this edit (the
 * hashes of the lines being replaced). A bare-hash prefix that neither hashes its own
 * remainder nor appears there is only removed when some other line in the same payload
 * proved the payload carries anchors, so ordinary text containing an arrow is left untouched.
 */
export function stripAnchorPrefixes(
	text: string,
	knownHashes: ReadonlySet<string> = new Set(),
): AnchorPrefixStripResult {
	const lines = text.split("\n");
	const classified = lines.map((line) => classifyAnchorPrefix(line, knownHashes));
	if (classified.every((entry) => entry.prefixLength === 0)) {
		return { text, strippedLines: [] };
	}
	const hasConfidentPrefix = classified.some((entry) => entry.confident);
	const strippedLines: number[] = [];
	const output = lines.map((line, index) => {
		const entry = classified[index];
		if (entry.prefixLength === 0) return line;
		if (!entry.confident && !hasConfidentPrefix) return line;
		strippedLines.push(index + 1);
		return line.slice(entry.prefixLength);
	});
	return { text: output.join("\n"), strippedLines };
}

export interface ParsedAnchor {
	readonly line: number;
	readonly hash: string;
}

export function parseAnchor(anchor: string): ParsedAnchor | undefined {
	const cleaned = anchor.split(ANCHOR_SEPARATOR, 1)[0]?.trim() ?? "";
	const match = /^(\d+):([0-9a-z]{2,8})$/.exec(cleaned);
	if (!match) return undefined;
	const line = Number.parseInt(match[1], 10);
	if (line < 1) return undefined;
	return { line, hash: match[2] };
}

export function findHashLines(lines: readonly string[], hash: string): number[] {
	const hits: number[] = [];
	for (let index = 0; index < lines.length; index++) {
		if (anchorLineHash(lines[index]) === hash) hits.push(index + 1);
	}
	return hits;
}

export type AnchorValidation =
	| { readonly status: "ok"; readonly line: number }
	| { readonly status: "shifted"; readonly line: number }
	| { readonly status: "stale" };

export function validateAnchor(
	lines: readonly string[],
	anchor: ParsedAnchor,
	radius: number = ANCHOR_SEARCH_RADIUS,
): AnchorValidation {
	const index = anchor.line - 1;
	if (index >= 0 && index < lines.length && anchorLineHash(lines[index]) === anchor.hash) {
		return { status: "ok", line: anchor.line };
	}

	let firstHit = -1;
	for (let distance = 1; distance <= radius; distance++) {
		for (const candidate of [index - distance, index + distance]) {
			if (candidate < 0 || candidate >= lines.length || anchorLineHash(lines[candidate]) !== anchor.hash) continue;
			if (firstHit !== -1) return { status: "stale" };
			firstHit = candidate;
		}
	}
	return firstHit === -1 ? { status: "stale" } : { status: "shifted", line: firstHit + 1 };
}

export function renderAnchorRegion(lines: readonly string[], centerLine: number, context = 3): string {
	const start = Math.max(1, centerLine - context);
	const end = Math.min(lines.length, centerLine + context);
	if (end < start) return "(file is empty)";
	return renderAnchoredLines(lines.slice(start - 1, end), start).join("\n");
}
