/**
 * Classify markdown `href` values for chat text blocks.
 *
 * LLMs emit many shapes: `file://`, POSIX `/abs`, Windows `C:\…`,
 * relative `./foo` / `src/a.ts`, and real `https://` URLs. Misclassifying a
 * local path as a generic anchor (especially with `target="_blank"`) opens
 * the system browser instead of the in-app file preview.
 *
 * Also: `react-markdown`'s `defaultUrlTransform` treats `C:` as an unknown
 * protocol and blanks the href — Windows paths must be allowlisted via
 * {@link chatUrlTransform}. Models also occasionally omit CommonMark's angle
 * brackets around local destinations that contain whitespace. The normalizer
 * repairs those legacy forms before parse and standardizes local destinations.
 */

import { defaultUrlTransform } from "react-markdown";

export type MarkdownLinkKind =
	| { type: "file"; path: string }
	| { type: "url"; url: string }
	| { type: "other"; href: string };

function safeDecode(raw: string): string {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

function toPosixSeparators(path: string): string {
	return path.replace(/\\/g, "/");
}

/**
 * Allow local filesystem hrefs that `defaultUrlTransform` would strip because
 * it sees `C:` / `file:` as unsafe protocols. Everything else keeps the
 * library default (blocks `javascript:` etc.).
 */
export function chatUrlTransform(url: string): string {
	// Windows drive: C:\… C:/… or rehype-encoded C:%5C…
	if (/^[A-Za-z]:[\\/]/.test(url) || /^[A-Za-z]:%5[Cc]/i.test(url)) {
		return url;
	}
	// file:// local URLs
	if (/^file:/i.test(url)) {
		return url;
	}
	return defaultUrlTransform(url);
}

interface MarkdownFence {
	character: "`" | "~";
	length: number;
}

const STANDARD_LINK_TITLE = /^(\S+)(\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\([^()]*\)))$/;

function splitStandardLinkTitle(destination: string): { path: string; title: string } {
	const match = STANDARD_LINK_TITLE.exec(destination);
	return match ? { path: match[1], title: match[2] } : { path: destination, title: "" };
}

function normalizeAbsoluteLocalDestination(path: string): string | null {
	if (!path || /[<>\r\n]/.test(path)) return null;
	if (/^\\\\[^\\]/.test(path)) {
		return `file://${path.slice(2).replace(/\\/g, "/")}`;
	}
	if (/^file:/i.test(path)) return path.replace(/\\/g, "/");
	if (/^\/?[A-Za-z]:[\\/]/.test(path)) return path.replace(/\\/g, "/");
	if (path.startsWith("/") && !path.startsWith("//")) return path;
	return null;
}

function normalizeBareDestination(destination: string): string | null {
	const { path, title } = splitStandardLinkTitle(destination);
	const normalized = normalizeAbsoluteLocalDestination(path);
	return normalized ? `<${normalized}>${title}` : null;
}

function findBareDestinationEnd(line: string, start: number): number {
	let parenthesesDepth = 0;
	for (let index = start; index < line.length; index++) {
		if (line[index] === "(") {
			parenthesesDepth++;
			continue;
		}
		if (line[index] !== ")") continue;
		if (parenthesesDepth === 0) return index;
		parenthesesDepth--;
	}
	return -1;
}

function normalizeMarkdownLine(line: string): string {
	if (/^(?: {4}|\t)/.test(line)) return line;

	let result = "";
	let cursor = 0;
	let codeDelimiterLength = 0;
	for (let index = 0; index < line.length; ) {
		if (line[index] === "`") {
			let end = index + 1;
			while (line[end] === "`") end++;
			const runLength = end - index;
			if (codeDelimiterLength === 0) codeDelimiterLength = runLength;
			else if (runLength === codeDelimiterLength) codeDelimiterLength = 0;
			index = end;
			continue;
		}

		if (codeDelimiterLength !== 0 || line[index] !== "]" || line[index + 1] !== "(") {
			index++;
			continue;
		}

		const destinationStart = index + 2;
		if (line[destinationStart] === "<") {
			const angleEnd = line.indexOf(">)", destinationStart + 1);
			if (angleEnd === -1) {
				index++;
				continue;
			}
			const normalized = normalizeAbsoluteLocalDestination(line.slice(destinationStart + 1, angleEnd));
			if (!normalized) {
				index = angleEnd + 2;
				continue;
			}
			result += `${line.slice(cursor, destinationStart)}<${normalized}>)`;
			cursor = angleEnd + 2;
			index = cursor;
			continue;
		}

		const destinationEnd = findBareDestinationEnd(line, destinationStart);
		if (destinationEnd === -1) {
			index++;
			continue;
		}
		const normalized = normalizeBareDestination(line.slice(destinationStart, destinationEnd));
		if (!normalized) {
			index = destinationEnd + 1;
			continue;
		}
		result += `${line.slice(cursor, destinationStart)}${normalized})`;
		cursor = destinationEnd + 1;
		index = cursor;
	}
	return result + line.slice(cursor);
}

/**
 * Standardize absolute local link destinations as CommonMark angle-bracket
 * destinations before parsing. This makes whitespace and balanced parentheses
 * unambiguous, converts Windows separators, and repairs already persisted model
 * output such as `[file](/C:/Users/name/My Files/file.md)`.
 *
 */
export function normalizeLocalFileLinksInMarkdown(markdown: string): string {
	const parts = markdown.split(/(\r\n|\n|\r)/);
	let fence: MarkdownFence | null = null;
	return parts
		.map((part) => {
			if (part === "\n" || part === "\r" || part === "\r\n") return part;
			const marker = /^ {0,3}(`{3,}|~{3,})/.exec(part)?.[1];
			if (marker) {
				const character = marker[0] as MarkdownFence["character"];
				if (!fence) fence = { character, length: marker.length };
				else if (
					character === fence.character &&
					marker.length >= fence.length &&
					part.slice(part.indexOf(marker) + marker.length).trim() === ""
				) {
					fence = null;
				}
				return part;
			}
			return fence ? part : normalizeMarkdownLine(part);
		})
		.join("");
}

/**
 * Convert a `file://` URL to an OS path (POSIX absolute or Windows drive/UNC).
 * Returns null when the input is not a usable file URL.
 */
export function fileUrlToPath(href: string): string | null {
	try {
		const url = new URL(href);
		if (url.protocol !== "file:") return null;
		let path = safeDecode(url.pathname);
		// Windows drive: /C:/Users → C:/Users
		if (/^\/[A-Za-z]:/.test(path)) {
			path = path.slice(1);
		}
		// UNC: file://server/share/path → //server/share/path
		if (url.hostname && url.hostname !== "localhost") {
			const body = path.startsWith("/") ? path : `/${path}`;
			path = `//${url.hostname}${body}`;
		}
		return toPosixSeparators(path) || null;
	} catch {
		const stripped = safeDecode(href.replace(/^file:\/\//i, ""));
		if (!stripped) return null;
		if (/^\/[A-Za-z]:/.test(stripped)) {
			return toPosixSeparators(stripped.slice(1));
		}
		return toPosixSeparators(stripped);
	}
}

/**
 * Bare names like `readme.md` should open as files; bare domains like
 * `www.example.com` must not. Prefer path separators / relative prefixes;
 * fall back to a conservative extension allowlist (not generic TLDs).
 */
const LIKELY_FILE_EXT =
	/\.(?:tsx?|jsx?|mjs|cjs|json|mdx?|txt|pdf|png|jpe?g|gif|webp|svg|html?|css|scss|less|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|zsh|ya?ml|toml|xml|csv|tsv|xlsx?|docx?|pptx?|zip|gz|tgz|7z|rar|mp3|mp4|wav|webm|ico|woff2?|ttf|otf|map|sql|vue|svelte|astro|wasm|log|conf|cfg|ini|plist|ipynb|rtf|lock|env)$/i;

function looksLikeRelativeFilePath(value: string): boolean {
	if (/^[.]{1,2}[\\/]/.test(value)) return true;
	if (/[\\/]/.test(value)) return true;
	return LIKELY_FILE_EXT.test(value);
}

/**
 * Classify a markdown link href into file / external URL / other.
 * File paths are returned with `/` separators; relative paths are left relative
 * for the host to resolve against the project cwd.
 */
export function classifyMarkdownLink(href: string | undefined): MarkdownLinkKind {
	if (!href) return { type: "other", href: "" };
	const trimmed = href.trim();
	if (!trimmed || trimmed.startsWith("#")) {
		return { type: "other", href: trimmed };
	}

	if (/^(mailto|tel|javascript|data|blob|vetta):/i.test(trimmed)) {
		return { type: "other", href: trimmed };
	}

	if (/^https?:\/\//i.test(trimmed)) {
		return { type: "url", url: trimmed };
	}

	// Protocol-relative URL (//cdn.example.com/x) — not a Windows UNC path.
	if (trimmed.startsWith("//") && !trimmed.startsWith("\\\\")) {
		return { type: "url", url: `https:${trimmed}` };
	}

	if (/^file:\/\//i.test(trimmed)) {
		const path = fileUrlToPath(trimmed);
		if (path) return { type: "file", path };
		return { type: "other", href: trimmed };
	}

	const decoded = safeDecode(trimmed);

	// Windows drive absolute: C:\… or C:/… (after decode of %5C)
	if (/^[A-Za-z]:[\\/]/.test(decoded)) {
		return { type: "file", path: toPosixSeparators(decoded) };
	}

	// Windows UNC: \\server\share
	if (decoded.startsWith("\\\\")) {
		return { type: "file", path: toPosixSeparators(decoded) };
	}

	// POSIX absolute
	if (decoded.startsWith("/")) {
		return { type: "file", path: decoded };
	}

	if (looksLikeRelativeFilePath(decoded)) {
		return { type: "file", path: toPosixSeparators(decoded) };
	}

	return { type: "other", href: trimmed };
}
