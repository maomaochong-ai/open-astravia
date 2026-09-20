import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import nodePath from "node:path";

/** 路径运算里工具真正用到的那一小块，`node:path` 与 `node:path/posix` 都满足。 */
export interface ToolPathSyntax {
	readonly isAbsolute: (path: string) => boolean;
	readonly resolve: (...segments: string[]) => string;
	readonly join: (...segments: string[]) => string;
	readonly dirname: (path: string) => string;
	readonly basename: (path: string) => string;
	readonly relative: (from: string, to: string) => string;
}

/**
 * 工具解析路径时所站的那台机器。
 *
 * 路径纠错（NFD、弯引号、相似文件名提示）靠探测文件系统，而探测必须发生在**文件所在
 * 的机器**上。项目在远端时若仍探本机，本机碰巧存在的同名变体会把远端的读写目标悄悄
 * 改掉，`~` 也会按本机家目录展开后发到远端。
 *
 * 探测是同步的，远端做不到；远端实现因此如实回答「不知道」，纠错随之关闭，其余路径
 * 运算保持同一份代码。
 */
export interface ToolPathHost {
	readonly path: ToolPathSyntax;
	/** `undefined` 表示不在这里展开 `~`，原样交给文件端口处理。 */
	readonly homeDirectory: () => string | undefined;
	readonly exists: (absolutePath: string) => boolean;
	/** 目录不可读或无法探测时返回 `undefined`。 */
	readonly listDirectory: (absolutePath: string) => readonly string[] | undefined;
}

export const localToolPathHost: ToolPathHost = {
	path: nodePath,
	homeDirectory: homedir,
	exists: (absolutePath) => {
		try {
			accessSync(absolutePath, constants.F_OK);
			return true;
		} catch {
			return false;
		}
	},
	listDirectory: (absolutePath) => {
		try {
			return readdirSync(absolutePath);
		} catch {
			return undefined;
		}
	},
};

/** POSIX 远端：不探测、不展开 `~`，路径运算固定用 POSIX 语义（本机可能是 Windows）。 */
export const remotePosixToolPathHost: ToolPathHost = {
	path: nodePath.posix,
	homeDirectory: () => undefined,
	exists: () => false,
	listDirectory: () => undefined,
};

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

function normalizeUnicodeSpaces(value: string): string {
	return value.replace(UNICODE_SPACES, " ");
}

function isHomeRelative(path: string): boolean {
	return path === "~" || path.startsWith("~/");
}

export function resolveToCwd(filePath: string, cwd: string, host: ToolPathHost = localToolPathHost): string {
	const normalized = normalizeUnicodeSpaces(filePath);
	if (isHomeRelative(normalized)) {
		const home = host.homeDirectory();
		// 不知道家目录时保持原样：拼到 cwd 后面会得到一个名叫 `~` 的子目录。
		return home === undefined ? normalized : home + normalized.slice(1);
	}
	if (host.path.isAbsolute(normalized)) {
		return normalized;
	}
	return host.path.resolve(cwd, normalized);
}

function tryFuzzyFilenameMatch(absolutePath: string, host: ToolPathHost): string | undefined {
	const directory = host.path.dirname(absolutePath);
	const target = host.path.basename(absolutePath).replace(/ /g, "").normalize("NFC");

	const entries = host.listDirectory(directory);
	if (entries === undefined) return undefined;

	const matches = entries.filter((entry) => entry.replace(/ /g, "").normalize("NFC") === target);
	if (matches.length === 1) {
		return host.path.join(directory, matches[0]);
	}
	return undefined;
}

export function resolveExistingPath(filePath: string, cwd: string, host: ToolPathHost = localToolPathHost): string {
	const fileExists = host.exists;
	const resolved = resolveToCwd(filePath, cwd, host);
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

	return tryFuzzyFilenameMatch(resolved, host) ?? resolved;
}

const MAX_SIMILAR_ENTRIES = 3;
/** Single-character leaves match nearly every sibling, so they produce noise instead of hints. */
const MIN_LEAF_LENGTH = 2;

function findSimilarSiblings(absolutePath: string, host: ToolPathHost): string[] {
	const leaf = host.path.basename(absolutePath).toLowerCase();
	if (leaf.length < MIN_LEAF_LENGTH) return [];
	const entries = host.listDirectory(host.path.dirname(absolutePath));
	if (entries === undefined) return [];
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
export function formatNotFoundPath(absolutePath: string, cwd: string, host: ToolPathHost = localToolPathHost): string {
	const base = `Path not found: ${absolutePath}`;
	const similar = findSimilarSiblings(absolutePath, host);
	const hint = similar.length > 0 ? `\nSimilar entries in the parent directory: ${similar.join(", ")}` : "";
	return `${base}${hint}\nNote: your current working directory is ${cwd}`;
}

export function resolveWritablePath(filePath: string, cwd: string, host: ToolPathHost = localToolPathHost): string {
	const resolved = resolveToCwd(filePath, cwd, host);
	if (host.exists(resolved)) return resolved;
	const corrected = resolveExistingPath(filePath, cwd, host);
	return corrected !== resolved && host.exists(corrected) ? corrected : resolved;
}

export const resolveReadPath = resolveExistingPath;
