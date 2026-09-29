import type { PackageManager } from "./model";

export interface PackageJsonInfo {
	readonly name?: string;
	readonly packageManager?: PackageManager;
	/** 按文件里出现的顺序：作者通常把最常用的 dev / build 写在前面。 */
	readonly scripts: readonly { readonly name: string; readonly body: string }[];
}

const PACKAGE_MANAGERS: readonly PackageManager[] = ["bun", "pnpm", "yarn", "npm"];

/** `"packageManager": "pnpm@9.1.0"` → `pnpm`；不认识的工具当没写。 */
function parsePackageManagerField(value: unknown): PackageManager | undefined {
	if (typeof value !== "string") return undefined;
	const name = value.split("@")[0]?.trim();
	return PACKAGE_MANAGERS.find((candidate) => candidate === name);
}

/** 坏 JSON 返回 null：一个写坏的子包不该让整个列表出不来。 */
export function parsePackageJson(text: string): PackageJsonInfo | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const value = raw as Record<string, unknown>;
	const scripts: { name: string; body: string }[] = [];
	if (typeof value.scripts === "object" && value.scripts !== null && !Array.isArray(value.scripts)) {
		for (const [name, body] of Object.entries(value.scripts as Record<string, unknown>)) {
			if (typeof body === "string" && name.trim().length > 0) scripts.push({ name, body });
		}
	}
	return {
		name: typeof value.name === "string" && value.name.trim() ? value.name : undefined,
		packageManager: parsePackageManagerField(value.packageManager),
		scripts,
	};
}

export interface MakeTarget {
	readonly name: string;
	/** `target: deps ## 说明` 这种自文档写法里的说明。 */
	readonly description?: string;
}

/** 规则行：`a b: deps`。排除 `:=` / `::=` 赋值，`::` 双冒号规则照收。 */
const RULE_LINE = /^([^\s:=#][^:=#]*?)\s*::?(?![=])(.*)$/;
const TARGET_NAME = /^[A-Za-z0-9_][A-Za-z0-9_./+-]*$/;

/**
 * 从 Makefile 文本里取出用户能直接 `make <target>` 的目标。
 *
 * 不做完整的 make 解析，只挑出「看起来是给人跑的」那些：跳过 `.PHONY` 之类的特殊目标、
 * 含 `%` 的模式规则、含 `$` 的变量展开、以及以制表符开头的配方行；这些要么不能直接跑，
 * 要么根本不是目标。
 */
export function parseMakefileTargets(text: string): MakeTarget[] {
	const seen = new Map<string, MakeTarget>();
	const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
	for (const line of lines) {
		if (line.startsWith("\t") || line.trimStart().startsWith("#")) continue;
		const match = RULE_LINE.exec(line);
		if (!match) continue;
		const [, targets = "", rest = ""] = match;
		if (/^\s*(export|override|define|include|-include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif)\b/.test(targets)) {
			continue;
		}
		const descriptionIndex = rest.indexOf("##");
		const description = descriptionIndex >= 0 ? rest.slice(descriptionIndex + 2).trim() || undefined : undefined;
		for (const name of targets.trim().split(/\s+/)) {
			if (!TARGET_NAME.test(name) || name.includes("%")) continue;
			const previous = seen.get(name);
			if (!previous || (!previous.description && description)) seen.set(name, { name, description });
		}
	}
	return [...seen.values()];
}

/** 锁文件 → 包管理器。`bun.lockb` 是 bun 1.2 之前的二进制锁文件。 */
export const LOCKFILE_MANAGERS: Readonly<Record<string, PackageManager>> = {
	"bun.lock": "bun",
	"bun.lockb": "bun",
	"pnpm-lock.yaml": "pnpm",
	"yarn.lock": "yarn",
	"package-lock.json": "npm",
};

export const MAKEFILE_NAMES = ["Makefile", "makefile", "GNUmakefile"] as const;

/** 能直接当 shell 单词的名字不加引号，其余用双引号包起来（POSIX shell、PowerShell、cmd 都认）。 */
export function quoteShellWord(word: string): string {
	return /^[A-Za-z0-9_:./@+=-]+$/.test(word) ? word : `"${word.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function packageScriptCommand(manager: PackageManager, script: string): string {
	return `${manager} run ${quoteShellWord(script)}`;
}

export function makeTargetCommand(fileName: string, target: string): string {
	// make 自己会按 GNUmakefile → makefile → Makefile 的顺序找；同目录多份时只有第一份生效，
	// 这里显式 -f 才能让列表里看到的就是实际跑的。
	const flag = fileName === "Makefile" ? "" : `-f ${quoteShellWord(fileName)} `;
	return `make ${flag}${quoteShellWord(target)}`;
}
