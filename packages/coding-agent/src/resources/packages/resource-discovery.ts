import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import ignore from "ignore";
import type { ResourceKind } from "../contracts/resource-source.js";

const ResourceEntriesSchema = Type.Array(Type.String());
const ResourceManifestSchema = Type.Object(
	{
		extensions: Type.Optional(ResourceEntriesSchema),
		skills: Type.Optional(ResourceEntriesSchema),
		prompts: Type.Optional(ResourceEntriesSchema),
		themes: Type.Optional(ResourceEntriesSchema),
	},
	{ additionalProperties: true },
);

export type ResourceManifest = Static<typeof ResourceManifestSchema>;

const FILE_PATTERNS: Record<ResourceKind, RegExp> = {
	extensions: /\.(ts|js)$/,
	skills: /\.md$/,
	prompts: /\.md$/,
	themes: /\.json$/,
};

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];
type IgnoreMatcher = ReturnType<typeof ignore>;

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("\\#"))) return null;

	let pattern = line;
	let negated = false;
	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}
	if (pattern.startsWith("/")) pattern = pattern.slice(1);
	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}

function addIgnoreRules(matcher: IgnoreMatcher, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";
	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename);
		if (!existsSync(ignorePath)) continue;
		try {
			const patterns = readFileSync(ignorePath, "utf-8")
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) matcher.add(patterns);
		} catch {}
	}
}

function collectFiles(
	dir: string,
	filePattern: RegExp,
	skipNodeModules = true,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;
	const root = rootDir ?? dir;
	const matcher = ignoreMatcher ?? ignore();
	addIgnoreRules(matcher, dir, root);

	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".") || (skipNodeModules && entry.name === "node_modules")) continue;
			const fullPath = join(dir, entry.name);
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}
			const relativePath = toPosixPath(relative(root, fullPath));
			if (matcher.ignores(isDirectory ? `${relativePath}/` : relativePath)) continue;
			if (isDirectory) files.push(...collectFiles(fullPath, filePattern, skipNodeModules, matcher, root));
			else if (isFile && filePattern.test(entry.name)) files.push(fullPath);
		}
	} catch {}
	return files;
}

function collectSkillEntries(
	dir: string,
	includeRootFiles = true,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;
	const root = rootDir ?? dir;
	const matcher = ignoreMatcher ?? ignore();
	addIgnoreRules(matcher, dir, root);

	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const fullPath = join(dir, entry.name);
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}
			const relativePath = toPosixPath(relative(root, fullPath));
			if (matcher.ignores(isDirectory ? `${relativePath}/` : relativePath)) continue;
			if (isDirectory) entries.push(...collectSkillEntries(fullPath, false, matcher, root));
			else if (isFile && ((includeRootFiles && entry.name.endsWith(".md")) || entry.name === "SKILL.md")) {
				entries.push(fullPath);
			}
		}
	} catch {}
	return entries;
}

export function collectAutoSkillEntries(dir: string, includeRootFiles = true): string[] {
	return collectSkillEntries(dir, includeRootFiles);
}

export function collectAncestorAgentSkillEntries(cwd: string): string[] {
	const entries: string[] = [];
	let current = resolve(cwd);
	while (true) {
		entries.push(...collectSkillEntries(join(current, ".agents", "skills"), false));
		if (existsSync(join(current, ".git"))) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return entries;
}

export function collectAutoPromptEntries(dir: string): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;
	const matcher = ignore();
	addIgnoreRules(matcher, dir, dir);
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const fullPath = join(dir, entry.name);
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}
			if (!matcher.ignores(toPosixPath(relative(dir, fullPath))) && isFile && entry.name.endsWith(".md")) {
				entries.push(fullPath);
			}
		}
	} catch {}
	return entries;
}

export function collectAutoThemeEntries(dir: string): string[] {
	return collectTopLevelFiles(dir, ".json");
}

function collectTopLevelFiles(dir: string, suffix: string): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;
	const matcher = ignore();
	addIgnoreRules(matcher, dir, dir);
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const fullPath = join(dir, entry.name);
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}
			if (!matcher.ignores(toPosixPath(relative(dir, fullPath))) && isFile && entry.name.endsWith(suffix)) {
				entries.push(fullPath);
			}
		}
	} catch {}
	return entries;
}

export function readResourceManifest(packageRoot: string): ResourceManifest | null {
	const packageJsonPath = join(packageRoot, "package.json");
	if (!existsSync(packageJsonPath)) return null;
	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { pi?: unknown };
		return parsed.pi !== undefined && Value.Check(ResourceManifestSchema, parsed.pi) ? parsed.pi : null;
	} catch {
		return null;
	}
}

function resolveExtensionEntries(dir: string): string[] | null {
	const manifest = readResourceManifest(dir);
	if (manifest?.extensions?.length) {
		const entries = manifest.extensions.map((path) => resolve(dir, path)).filter(existsSync);
		if (entries.length > 0) return entries;
	}
	const indexTs = join(dir, "index.ts");
	const indexJs = join(dir, "index.js");
	if (existsSync(indexTs)) return [indexTs];
	if (existsSync(indexJs)) return [indexJs];
	return null;
}

export function collectAutoExtensionEntries(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const rootEntries = resolveExtensionEntries(dir);
	if (rootEntries) return rootEntries;
	const entries: string[] = [];
	const matcher = ignore();
	addIgnoreRules(matcher, dir, dir);
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const fullPath = join(dir, entry.name);
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}
			const relativePath = toPosixPath(relative(dir, fullPath));
			if (matcher.ignores(isDirectory ? `${relativePath}/` : relativePath)) continue;
			if (isFile && /\.(ts|js)$/.test(entry.name)) entries.push(fullPath);
			else if (isDirectory) entries.push(...(resolveExtensionEntries(fullPath) ?? []));
		}
	} catch {}
	return entries;
}

export function collectResourceFiles(dir: string, resourceKind: ResourceKind): string[] {
	if (resourceKind === "skills") return collectSkillEntries(dir);
	if (resourceKind === "extensions") return collectAutoExtensionEntries(dir);
	return collectFiles(dir, FILE_PATTERNS[resourceKind]);
}
