import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

function normalizeUnicodeSpaces(value: string): string {
	return value.replace(UNICODE_SPACES, " ");
}

function expandPath(filePath: string): string {
	const normalized = normalizeUnicodeSpaces(filePath);
	if (normalized === "~") {
		return homedir();
	}
	if (normalized.startsWith("~/")) {
		return homedir() + normalized.slice(1);
	}
	return normalized;
}

export function resolveToCwd(filePath: string, cwd: string): string {
	const expanded = expandPath(filePath);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(cwd, expanded);
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function tryFuzzyFilenameMatch(absolutePath: string): string | undefined {
	const directory = dirname(absolutePath);
	const target = basename(absolutePath).replace(/ /g, "").normalize("NFC");

	let entries: string[];
	try {
		entries = readdirSync(directory);
	} catch {
		return undefined;
	}

	const matches = entries.filter((entry) => entry.replace(/ /g, "").normalize("NFC") === target);
	if (matches.length === 1) {
		return join(directory, matches[0]);
	}
	return undefined;
}

export function resolveExistingPath(filePath: string, cwd: string): string {
	const resolved = resolveToCwd(filePath, cwd);
	if (fileExists(resolved)) {
		return resolved;
	}

	const amPmVariant = resolved.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
	if (amPmVariant !== resolved && fileExists(amPmVariant)) {
		return amPmVariant;
	}

	const nfdVariant = resolved.normalize("NFD");
	if (nfdVariant !== resolved && fileExists(nfdVariant)) {
		return nfdVariant;
	}

	const curlyVariant = resolved.replace(/'/g, "\u2019");
	if (curlyVariant !== resolved && fileExists(curlyVariant)) {
		return curlyVariant;
	}

	const nfdCurlyVariant = nfdVariant.replace(/'/g, "\u2019");
	if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) {
		return nfdCurlyVariant;
	}

	return tryFuzzyFilenameMatch(resolved) ?? resolved;
}

const MAX_SIMILAR_ENTRIES = 3;
/** Single-character leaves match nearly every sibling, so they produce noise instead of hints. */
const MIN_LEAF_LENGTH = 2;

function findSimilarSiblings(absolutePath: string): string[] {
	const leaf = basename(absolutePath).toLowerCase();
	if (leaf.length < MIN_LEAF_LENGTH) return [];
	let entries: string[];
	try {
		entries = readdirSync(dirname(absolutePath));
	} catch {
		return [];
	}
	return entries
		.filter((entry) => {
			const candidate = entry.toLowerCase();
			return candidate !== leaf && (candidate.includes(leaf) || leaf.includes(candidate));
		})
		.slice(0, MAX_SIMILAR_ENTRIES);
}

/**
 * Builds the not-found message every path-taking coding tool returns.
 *
 * The working-directory line is unconditional: a model that mis-resolves a path is usually
 * wrong about where it is, not about the file name, and it cannot see the process cwd.
 */
export function formatNotFoundPath(absolutePath: string, cwd: string): string {
	const base = `Path not found: ${absolutePath}`;
	const similar = findSimilarSiblings(absolutePath);
	const hint = similar.length > 0 ? `\nSimilar entries in the parent directory: ${similar.join(", ")}` : "";
	return `${base}${hint}\nNote: your current working directory is ${cwd}`;
}

export function resolveWritablePath(filePath: string, cwd: string): string {
	const resolved = resolveToCwd(filePath, cwd);
	if (fileExists(resolved)) return resolved;
	const corrected = resolveExistingPath(filePath, cwd);
	return corrected !== resolved && fileExists(corrected) ? corrected : resolved;
}

export const resolveReadPath = resolveExistingPath;
