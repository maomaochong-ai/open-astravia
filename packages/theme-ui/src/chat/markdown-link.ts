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
 * {@link chatUrlTransform}. CommonMark also eats `\f` / `\.` etc. inside link
 * destinations; {@link normalizeWindowsPathsInMarkdownLinks} rewrites those
 * destinations to `/` before parse.
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

/**
 * Rewrite Windows drive paths in markdown link destinations to use `/`.
 * CommonMark treats `\f`, `\.`, `\U`… as escapes and corrupts paths like
 * `C:\Users\x\.vetta\a.html` → `C:\Users\x.vetta\a.html`.
 */
export function normalizeWindowsPathsInMarkdownLinks(markdown: string): string {
	// Angle-bracket destinations: ](<C:\path\with spaces>)
	let out = markdown.replace(/\]\(<([A-Za-z]):\\([^>]+)>\)/g, (_m, drive: string, rest: string) => {
		return `](<${drive}:/${rest.replace(/\\/g, "/")}>)`;
	});
	// Bare destinations: ](C:\path\no-spaces)
	out = out.replace(/\]\(([A-Za-z]):\\([^)\s]+)\)/g, (_m, drive: string, rest: string) => {
		return `](${drive}:/${rest.replace(/\\/g, "/")})`;
	});
	return out;
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
