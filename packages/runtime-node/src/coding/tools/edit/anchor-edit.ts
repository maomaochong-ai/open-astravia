import {
	ANCHOR_SEPARATOR,
	findHashLines,
	type ParsedAnchor,
	parseAnchor,
	renderAnchorRegion,
	validateAnchor,
} from "../../shared/anchors.js";
import type { EditToolDetails } from "./edit-contracts.js";
import { detectLineEnding, generateDiffString, normalizeToLF, restoreLineEndings, stripBom } from "./edit-text.js";
import type { AnchorEditInput } from "./schema.js";

const CLOSING_LINE_PATTERNS = {
	curly: /^}+.*$/,
	square: /^\]+.*$/,
	jsx: /^(?:<\/[A-Za-z][\w.:-]*\s*>|<\/\s*>).*$/,
} as const;

type ClosingLineKind = keyof typeof CLOSING_LINE_PATTERNS;

interface ResolvedAnchorEdit {
	readonly startLine: number;
	readonly endLine: number;
	readonly newText: string;
	readonly insertAfter: boolean;
	readonly index: number;
}

export interface AnchorEditResult {
	readonly content: string;
	readonly receipt: string;
	readonly details: EditToolDetails;
}

function closingLineKind(line: string): ClosingLineKind | undefined {
	const trimmed = line.trim();
	return (Object.entries(CLOSING_LINE_PATTERNS) as Array<[ClosingLineKind, RegExp]>).find(([, pattern]) =>
		pattern.test(trimmed),
	)?.[0];
}

function withoutCommentsStringsAndRegex(text: string): string {
	return text.replace(
		/(?:\/(?![*/])(?:\\.|[^/\\\n])+\/[dgimsuvy]*)|(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g,
		"",
	);
}

function hasUnclosedJsxTag(text: string): boolean {
	const stack: string[] = [];
	const tagPattern = /<(\/)?([A-Za-z][\w.:-]*)(?:\s[^<>]*?)?(\/?)>|<(\/?)\s*>/g;
	const codeOnly = withoutCommentsStringsAndRegex(text);
	for (const match of codeOnly.matchAll(tagPattern)) {
		const [, closing, name, selfClosing, fragmentClosing] = match;
		if (name === undefined) {
			if (fragmentClosing) {
				if (stack.at(-1) === "<>") stack.pop();
			} else {
				stack.push("<>");
			}
		} else if (!selfClosing) {
			if (!closing) stack.push(name);
			else if (stack.at(-1) === name) stack.pop();
		}
	}
	return stack.length > 0;
}

function hasUnclosedStructuralTail(text: string, kind: ClosingLineKind): boolean {
	if (kind === "jsx") return hasUnclosedJsxTag(text);
	const [opening, closing] = kind === "curly" ? ["{", "}"] : ["[", "]"];
	const codeOnly = withoutCommentsStringsAndRegex(text);
	let depth = 0;
	for (const character of codeOnly) {
		if (character === opening) depth++;
		if (character === closing) depth--;
	}
	return depth > 0;
}

function dropsStructuralClosingLine(lines: readonly string[], edit: ResolvedAnchorEdit): boolean {
	if (edit.insertAfter || edit.newText.length === 0) return false;
	const originalKind = closingLineKind(lines[edit.endLine - 1]);
	if (!originalKind) return false;
	if (hasUnclosedStructuralTail(edit.newText, originalKind)) return true;
	if (edit.startLine !== edit.endLine) return false;
	const replacementLines = edit.newText.split(/\r?\n/).filter((line) => line.trim().length > 0);
	const replacementLastLine = replacementLines.at(-1);
	return replacementLastLine === undefined || closingLineKind(replacementLastLine) !== originalKind;
}

function parseAnchorLenient(lines: readonly string[], raw: string, label: string): ParsedAnchor {
	const parsed = parseAnchor(raw);
	if (parsed) return parsed;
	const cleaned = raw.split(ANCHOR_SEPARATOR, 1)[0]?.trim() ?? "";
	if (/^\d+$/.test(cleaned)) {
		throw new Error(
			`${label} "${raw}" looks like a bare line number — the ":hash" part is required. Anchors are the WHOLE "line:hash" prefix from read/grep/edit output (e.g. "42:h7x2"); copy it verbatim.`,
		);
	}
	if (/^[0-9a-z]{2,8}$/.test(cleaned)) {
		const hits = findHashLines(lines, cleaned);
		if (hits.length === 1) return { line: hits[0], hash: cleaned };
		const detail =
			hits.length === 0
				? "matches no line in the file"
				: `matches ${hits.length} lines (${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ", …" : ""}) and cannot be disambiguated`;
		throw new Error(
			`${label} "${raw}" is a bare hash without the "line:" prefix and ${detail}. Anchors are the WHOLE "line:hash" prefix from read/grep/edit output (e.g. "42:h7x2" from a read line "42:h7x2→…"); the line number is part of the anchor — copy it verbatim.`,
		);
	}
	throw new Error(
		`${label} "${raw}" is malformed. Anchors look like "42:h7x2" and must be copied verbatim from read/grep/edit output.`,
	);
}

function resolveAnchorEdits(lines: readonly string[], edits: readonly AnchorEditInput[]): ResolvedAnchorEdit[] {
	const resolved: ResolvedAnchorEdit[] = [];
	const staleReports: string[] = [];
	for (let index = 0; index < edits.length; index++) {
		const edit = edits[index];
		const startAnchor = parseAnchorLenient(lines, edit.anchor, `edits[${index}].anchor`);
		if (edit.insert_after && edit.end_anchor !== undefined) {
			throw new Error(`edits[${index}]: insert_after cannot be combined with end_anchor.`);
		}
		const startValidation = validateAnchor(lines, startAnchor);
		if (startValidation.status === "stale") {
			staleReports.push(
				`edits[${index}] anchor "${edit.anchor}" is STALE (content changed). Fresh anchors near line ${startAnchor.line}:\n${renderAnchorRegion(lines, startAnchor.line)}`,
			);
			continue;
		}
		let endLine = startValidation.line;
		if (edit.end_anchor !== undefined) {
			const endAnchor = parseAnchorLenient(lines, edit.end_anchor, `edits[${index}].end_anchor`);
			const endValidation = validateAnchor(lines, endAnchor);
			if (endValidation.status === "stale") {
				staleReports.push(
					`edits[${index}] end_anchor "${edit.end_anchor}" is STALE. Fresh anchors near line ${endAnchor.line}:\n${renderAnchorRegion(lines, endAnchor.line)}`,
				);
				continue;
			}
			endLine = endValidation.line;
			if (endLine < startValidation.line) {
				staleReports.push(
					`edits[${index}] range is inverted after anchor recovery (start line ${startValidation.line} > end line ${endLine}). Fresh anchors:\n${renderAnchorRegion(lines, startValidation.line)}`,
				);
				continue;
			}
		}
		resolved.push({
			startLine: startValidation.line,
			endLine,
			newText: edit.new_text,
			insertAfter: edit.insert_after === true,
			index,
		});
	}

	if (staleReports.length > 0) {
		throw new Error(
			`Anchor edit rejected — ${staleReports.length} of ${edits.length} anchor(s) failed; NO changes were made (edits are atomic).\n\n${staleReports.join("\n\n")}\n\nRetry the FULL batch using the fresh anchors above. Never fabricate or reuse stale anchors.`,
		);
	}
	return resolved;
}

function validateResolvedEdits(
	lines: readonly string[],
	resolved: readonly ResolvedAnchorEdit[],
): ResolvedAnchorEdit[] {
	for (const edit of resolved) {
		if (!dropsStructuralClosingLine(lines, edit)) continue;
		const originalClosingLine = lines[edit.endLine - 1].trim();
		throw new Error(
			`Anchor replacement rejected: the inclusive range ends with structural closing line ${JSON.stringify(originalClosingLine)}, but new_text leaves that structure unclosed. This usually means new_text dropped the range's closing tail. Include the complete closing line and retry the FULL batch, or use an explicit empty new_text to delete the range.\nFresh anchors around the closing line:\n${renderAnchorRegion(lines, edit.endLine)}`,
		);
	}

	const sorted = [...resolved].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
	for (let index = 1; index < sorted.length; index++) {
		const previous = sorted[index - 1];
		const current = sorted[index];
		if (current.startLine === previous.startLine) {
			throw new Error(
				`edits[${previous.index}] and edits[${current.index}] both target line ${current.startLine}. Merge them into one edit.`,
			);
		}
		const previousEnd = previous.insertAfter ? previous.startLine : previous.endLine;
		const currentStart = current.insertAfter ? current.startLine + 1 : current.startLine;
		if (currentStart <= previousEnd) {
			throw new Error(
				`edits[${previous.index}] and edits[${current.index}] overlap (lines ${previous.startLine}-${previousEnd} vs ${current.startLine}). Merge them into one edit.`,
			);
		}
	}
	return sorted;
}

export function prepareAnchorEdits(
	rawContent: string,
	displayPath: string,
	edits: readonly AnchorEditInput[],
): AnchorEditResult {
	if (edits.length === 0) throw new Error("edits array is empty — provide at least one anchor edit.");
	const { bom, text: contentWithoutBom } = stripBom(rawContent);
	const originalEnding = detectLineEnding(contentWithoutBom);
	const normalized = normalizeToLF(contentWithoutBom);
	const lines = normalized.split("\n");
	const resolved = resolveAnchorEdits(lines, edits);
	const sorted = validateResolvedEdits(lines, resolved);
	const newLines = [...lines];
	let delta = 0;
	const appliedAt: number[] = [];
	for (const edit of sorted) {
		const replacementLines = edit.newText === "" && !edit.insertAfter ? [] : edit.newText.split("\n");
		if (edit.insertAfter) {
			const at = edit.startLine + delta;
			newLines.splice(at, 0, ...replacementLines);
			appliedAt.push(at + 1);
			delta += replacementLines.length;
		} else {
			const at = edit.startLine - 1 + delta;
			const removeCount = edit.endLine - edit.startLine + 1;
			newLines.splice(at, removeCount, ...replacementLines);
			appliedAt.push(at + 1);
			delta += replacementLines.length - removeCount;
		}
	}

	const newNormalized = newLines.join("\n");
	if (newNormalized === normalized) {
		throw new Error(`No changes made to ${displayPath}. The edits produced identical content.`);
	}
	const diffResult = generateDiffString(normalized, newNormalized);
	const receiptRegions = appliedAt
		.slice(0, 8)
		.map((line) => renderAnchorRegion(newLines, line, 2))
		.join("\n---\n");
	const receipt =
		`Applied ${resolved.length} anchor edit(s) to ${displayPath}.\n\n` +
		`Fresh anchors around the changes (use these to continue editing):\n${receiptRegions}` +
		(appliedAt.length > 8 ? `\n(… ${appliedAt.length - 8} more edit site(s) omitted)` : "");
	return {
		content: bom + restoreLineEndings(newNormalized, originalEnding),
		receipt,
		details: {
			diff: diffResult.diff,
			firstChangedLine: diffResult.firstChangedLine,
			appliedEdits: resolved.length,
		},
	};
}
