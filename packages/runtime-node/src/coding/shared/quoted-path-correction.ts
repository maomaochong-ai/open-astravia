import { localToolPathHost, resolveExistingPath, resolveToCwd, type ToolPathHost } from "./path-resolution.js";

const CJK_CHARS = /[\u3400-\u9fff\uf900-\ufaff]/;

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
	host: ToolPathHost = localToolPathHost,
): { readonly output: string; readonly pathCorrections: readonly PathLiteralCorrection[] } {
	let output = input;
	const pathCorrections: PathLiteralCorrection[] = [];
	const segments = findQuotedSegments(input);

	for (let index = segments.length - 1; index >= 0; index--) {
		const segment = segments[index];
		if (!isLikelyLiteralPath(segment.value)) continue;

		const originalPath = resolveToCwd(segment.value, cwd, host);
		if (host.exists(originalPath)) continue;
		const correctedPath = resolveExistingPath(segment.value, cwd, host);
		if (correctedPath === originalPath || !host.exists(correctedPath)) continue;

		const correctedLiteral = formatCorrectedPathLiteral(segment.value, correctedPath, cwd, host);
		if (correctedLiteral === segment.value) continue;
		output = output.slice(0, segment.contentStart) + correctedLiteral + output.slice(segment.contentEnd);
		pathCorrections.unshift({ original: segment.value, corrected: correctedLiteral });
	}

	return { output, pathCorrections };
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

function formatCorrectedPathLiteral(original: string, correctedPath: string, cwd: string, host: ToolPathHost): string {
	const home = host.homeDirectory();
	if (original === "~") return "~";
	if (original.startsWith("~/") && home !== undefined) {
		if (correctedPath === home) return "~";
		if (correctedPath.startsWith(`${home}/`)) return `~/${correctedPath.slice(home.length + 1)}`;
	}
	if (host.path.isAbsolute(original)) return correctedPath;
	return host.path.relative(cwd, correctedPath) || ".";
}
