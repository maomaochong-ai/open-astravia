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

export function resolveWritablePath(filePath: string, cwd: string): string {
	const resolved = resolveToCwd(filePath, cwd);
	if (fileExists(resolved)) return resolved;
	const corrected = resolveExistingPath(filePath, cwd);
	return corrected !== resolved && fileExists(corrected) ? corrected : resolved;
}

export const resolveReadPath = resolveExistingPath;
