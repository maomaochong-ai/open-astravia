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
