import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { resolveExistingPath } from "./path-resolution.js";

const CJK_CHARS = /[\u3400-\u9fff\uf900-\ufaff]/;
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export interface PathLiteralCorrection {
	readonly original: string;
	readonly corrected: string;
}

interface QuotedSegment {
	readonly contentStart: number;
	readonly contentEnd: number;
	readonly value: string;
}

export function rewriteQuotedPathLiterals(
	input: string,
	cwd: string,
): { readonly output: string; readonly pathCorrections: readonly PathLiteralCorrection[] } {
	let output = input;
	const pathCorrections: PathLiteralCorrection[] = [];
	const segments = findQuotedSegments(input);

	for (let index = segments.length - 1; index >= 0; index--) {
		const segment = segments[index];
		if (!isLikelyLiteralPath(segment.value)) continue;

		const originalPath = resolveLiteralPath(segment.value, cwd);
		if (pathExists(originalPath)) continue;
		const correctedPath = resolveExistingPath(segment.value, cwd);
		if (correctedPath === originalPath || !pathExists(correctedPath)) continue;

		const correctedLiteral = formatCorrectedPathLiteral(segment.value, correctedPath, cwd);
		if (correctedLiteral === segment.value) continue;
		output = output.slice(0, segment.contentStart) + correctedLiteral + output.slice(segment.contentEnd);
		pathCorrections.unshift({ original: segment.value, corrected: correctedLiteral });
	}

	return { output, pathCorrections };
}

function resolveLiteralPath(value: string, cwd: string): string {
	const normalized = value.replace(UNICODE_SPACES, " ");
	const expanded =
		normalized === "~" ? homedir() : normalized.startsWith("~/") ? homedir() + normalized.slice(1) : normalized;
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function pathExists(path: string): boolean {
	try {
		accessSync(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function isLikelyLiteralPath(value: string): boolean {
	if (!value || value.includes("$(") || value.includes("${") || value.includes("`")) return false;
	if (/[|;&<>*?[\]{}]/.test(value)) return false;
	if (value.includes("/") || value.includes("\\") || value.startsWith(".") || value.startsWith("~")) return true;
	if (!/\.[A-Za-z0-9]{1,10}$/.test(value)) return false;
	return CJK_CHARS.test(value) || /\s[-_]\s/.test(value);
}

function findQuotedSegments(text: string): QuotedSegment[] {
	const segments: QuotedSegment[] = [];
	for (let index = 0; index < text.length; index++) {
		const quote = text[index];
		if (quote !== '"' && quote !== "'") continue;
		let end = index + 1;
		for (; end < text.length; end++) {
			if (text[end] !== quote) continue;
			if (quote === '"' && text[end - 1] === "\\") continue;
			break;
		}
		if (end >= text.length) continue;
		segments.push({ contentStart: index + 1, contentEnd: end, value: text.slice(index + 1, end) });
		index = end;
	}
	return segments;
}

function formatCorrectedPathLiteral(original: string, correctedPath: string, cwd: string): string {
	const home = homedir();
	if (original === "~") return "~";
	if (original.startsWith("~/")) {
		if (correctedPath === home) return "~";
		if (correctedPath.startsWith(`${home}/`)) return `~/${correctedPath.slice(home.length + 1)}`;
	}
	if (isAbsolute(original)) return correctedPath;
	return relative(cwd, correctedPath) || ".";
}
