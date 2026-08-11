import * as Diff from "diff";

export function detectLineEnding(content: string): "\r\n" | "\n" {
	const crlfIndex = content.indexOf("\r\n");
	const lfIndex = content.indexOf("\n");
	if (lfIndex === -1 || crlfIndex === -1) return "\n";
	return crlfIndex < lfIndex ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

export function normalizeForFuzzyMatch(text: string): string {
	return text
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

interface FuzzyMatchResult {
	readonly found: boolean;
	readonly index: number;
	readonly matchLength: number;
	readonly contentForReplacement: string;
}

function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) {
		return { found: true, index: exactIndex, matchLength: oldText.length, contentForReplacement: content };
	}

	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
	if (fuzzyIndex === -1) {
		return { found: false, index: -1, matchLength: 0, contentForReplacement: content };
	}
	return {
		found: true,
		index: fuzzyIndex,
		matchLength: fuzzyOldText.length,
		contentForReplacement: fuzzyContent,
	};
}

export function stripBom(content: string): { readonly bom: string; readonly text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

export function generateDiffString(
	oldContent: string,
	newContent: string,
	contextLines = 4,
): { readonly diff: string; readonly firstChangedLine: number | undefined } {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const lineNumberWidth = String(Math.max(oldLines.length, newLines.length)).length;
	let oldLineNumber = 1;
	let newLineNumber = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		const raw = part.value.split("\n");
		if (raw.at(-1) === "") raw.pop();

		if (part.added || part.removed) {
			firstChangedLine ??= newLineNumber;
			for (const line of raw) {
				if (part.added) {
					output.push(`+${String(newLineNumber).padStart(lineNumberWidth, " ")} ${line}`);
					newLineNumber++;
				} else {
					output.push(`-${String(oldLineNumber).padStart(lineNumberWidth, " ")} ${line}`);
					oldLineNumber++;
				}
			}
			lastWasChange = true;
			continue;
		}

		const nextPart = parts[index + 1];
		const nextPartIsChange = nextPart !== undefined && (nextPart.added === true || nextPart.removed === true);
		if (!lastWasChange && !nextPartIsChange) {
			oldLineNumber += raw.length;
			newLineNumber += raw.length;
			lastWasChange = false;
			continue;
		}

		let linesToShow = raw;
		let skipStart = 0;
		let skipEnd = 0;
		if (!lastWasChange) {
			skipStart = Math.max(0, raw.length - contextLines);
			linesToShow = raw.slice(skipStart);
		}
		if (!nextPartIsChange && linesToShow.length > contextLines) {
			skipEnd = linesToShow.length - contextLines;
			linesToShow = linesToShow.slice(0, contextLines);
		}
		if (skipStart > 0) {
			output.push(` ${"".padStart(lineNumberWidth, " ")} ...`);
			oldLineNumber += skipStart;
			newLineNumber += skipStart;
		}
		for (const line of linesToShow) {
			output.push(` ${String(oldLineNumber).padStart(lineNumberWidth, " ")} ${line}`);
			oldLineNumber++;
			newLineNumber++;
		}
		if (skipEnd > 0) {
			output.push(` ${"".padStart(lineNumberWidth, " ")} ...`);
			oldLineNumber += skipEnd;
			newLineNumber += skipEnd;
		}
		lastWasChange = false;
	}

	return { diff: output.join("\n"), firstChangedLine };
}

export interface ExactTextEditResult {
	readonly content: string;
	readonly baseContent: string;
	readonly newContent: string;
}

export function prepareExactTextEdit(
	rawContent: string,
	oldText: string,
	newText: string,
	displayPath: string,
): ExactTextEditResult {
	const { bom, text: content } = stripBom(rawContent);
	const originalEnding = detectLineEnding(content);
	const normalizedContent = normalizeToLF(content);
	const normalizedOldText = normalizeToLF(oldText);
	const normalizedNewText = normalizeToLF(newText);
	const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);
	if (!matchResult.found) {
		throw new Error(
			`Could not find the exact text in ${displayPath}. The old text must match exactly including all whitespace and newlines.`,
		);
	}

	const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
	const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
	const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;
	if (occurrences > 1) {
		throw new Error(
			`Found ${occurrences} occurrences of the text in ${displayPath}. The text must be unique. Please provide more context to make it unique.`,
		);
	}

	const baseContent = matchResult.contentForReplacement;
	const replacedContent =
		baseContent.substring(0, matchResult.index) +
		normalizedNewText +
		baseContent.substring(matchResult.index + matchResult.matchLength);
	if (baseContent === replacedContent) {
		throw new Error(
			`No changes made to ${displayPath}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
		);
	}
	return {
		content: bom + restoreLineEndings(replacedContent, originalEnding),
		baseContent,
		newContent: replacedContent,
	};
}
