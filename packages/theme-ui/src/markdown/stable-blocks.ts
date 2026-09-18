export interface StableMarkdownSplit {
	readonly committed: readonly string[];
	readonly tail: string;
}

interface FenceMarker {
	readonly char: "`" | "~";
	readonly len: number;
	readonly markerEnd: number;
	readonly indent: number;
}

function stripLineEnding(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function readFenceMarker(line: string): FenceMarker | null {
	let index = 0;
	while (index < 3 && line[index] === " ") index += 1;
	const char = line[index];
	if (char !== "`" && char !== "~") return null;
	let len = 0;
	while (line[index + len] === char) len += 1;
	if (len < 3) return null;
	return { char, len, indent: index, markerEnd: index + len };
}

function isFenceOpeningLine(line: string): FenceMarker | null {
	const fence = readFenceMarker(line);
	if (!fence) return null;
	// CommonMark：只有反引号围栏的 info string 不能含反引号，波浪线围栏的 info string 可以含 `~`。
	if (fence.char === "`" && line.includes("`", fence.markerEnd)) return null;
	return fence;
}

function isFenceClosingLine(line: string, fenceChar: FenceMarker["char"], fenceLen: number): boolean {
	const fence = readFenceMarker(line);
	if (!fence || fence.char !== fenceChar || fence.len < fenceLen) return false;
	for (let index = fence.markerEnd; index < line.length; index += 1) {
		const char = line[index];
		if (char !== " " && char !== "\t") return false;
	}
	return true;
}

/**
 * Split append-only markdown so completed top-level fenced blocks can be frozen.
 *
 * Only an unindented closed code fence followed by more text is committed.
 * Indented fences stay in the tail so list items that wrap a code block are not
 * split into two documents (the second list would restart at 1). Blank lines
 * are not terminators. Because only whole top-level fences are committed, the
 * committed blocks of a prefix are a prefix of the committed blocks of any
 * append-only extension, so the caller keeps the split after streaming ends
 * instead of re-parsing the whole document (which would remount every node).
 */
export function splitStableMarkdownBlocks(text: string): StableMarkdownSplit {
	if (text.length === 0) return { committed: [], tail: "" };

	const committed: string[] = [];
	let start = 0;
	let index = 0;
	let inFence = false;
	let fenceChar: FenceMarker["char"] = "`";
	let fenceLen = 0;
	let commitOnClose = false;

	const commitThrough = (end: number): void => {
		if (end <= start || end > text.length) return;
		const block = text.slice(start, end);
		if (block.trim().length === 0) {
			start = end;
			return;
		}
		committed.push(block);
		start = end;
	};

	while (index < text.length) {
		const lineStart = index;
		const newline = text.indexOf("\n", index);
		const lineEnd = newline === -1 ? text.length : newline + 1;
		const line = stripLineEnding(text.slice(lineStart, newline === -1 ? text.length : newline));

		if (inFence) {
			if (isFenceClosingLine(line, fenceChar, fenceLen)) {
				inFence = false;
				if (commitOnClose && lineEnd < text.length) commitThrough(lineEnd);
				commitOnClose = false;
			}
			index = lineEnd;
			continue;
		}

		const opening = isFenceOpeningLine(line);
		if (opening) {
			inFence = true;
			fenceChar = opening.char;
			fenceLen = opening.len;
			commitOnClose = opening.indent === 0;
		}
		index = lineEnd;
	}

	return { committed, tail: text.slice(start) };
}
