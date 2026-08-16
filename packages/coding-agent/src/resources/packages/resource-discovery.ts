import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import ignore from "ignore";
import type { ResourceAccessPort, ResourceDirectoryEntry } from "../contracts/resource-access.js";
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

export interface ResourceDiscoveryOptions {
	readonly resourceAccess: ResourceAccessPort;
	readonly signal?: AbortSignal;
}

interface DiscoveryContext {
	readonly access: ResourceAccessPort;
	readonly signal?: AbortSignal;
}

function context(options: ResourceDiscoveryOptions): DiscoveryContext {
	return { access: options.resourceAccess, signal: options.signal };
}

function checkAborted(ctx: DiscoveryContext): void {
	ctx.signal?.throwIfAborted();
}

function toPosixPath(path: string): string {
	return path.replaceAll("\\", "/");
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

async function readText(ctx: DiscoveryContext, path: string): Promise<string | undefined> {
	checkAborted(ctx);
	try {
		return await ctx.access.files.readText(path, { signal: ctx.signal });
	} catch {
		checkAborted(ctx);
		return undefined;
	}
}

async function readDirectory(ctx: DiscoveryContext, path: string): Promise<readonly ResourceDirectoryEntry[]> {
	checkAborted(ctx);
	try {
		return await ctx.access.files.readDirectory(path, { signal: ctx.signal });
	} catch {
		checkAborted(ctx);
		return [];
	}
}

async function stat(ctx: DiscoveryContext, path: string) {
	checkAborted(ctx);
	try {
		return await ctx.access.files.stat(path, { signal: ctx.signal });
	} catch {
		checkAborted(ctx);
		return undefined;
	}
}

async function resolvedEntryKind(
	ctx: DiscoveryContext,
	path: string,
	entry: ResourceDirectoryEntry,
): Promise<"file" | "directory" | "other"> {
	if (!entry.symbolicLink) return entry.kind;
	return (await stat(ctx, path))?.kind ?? "other";
}

async function addIgnoreRules(
	ctx: DiscoveryContext,
	matcher: IgnoreMatcher,
	dir: string,
	rootDir: string,
): Promise<void> {
	const relativeDir = ctx.access.paths.relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";
	for (const filename of IGNORE_FILE_NAMES) {
		const content = await readText(ctx, ctx.access.paths.join(dir, filename));
		if (content === undefined) continue;
		const patterns = content
			.split(/\r?\n/)
			.map((line) => prefixIgnorePattern(line, prefix))
			.filter((line): line is string => Boolean(line));
		if (patterns.length > 0) matcher.add(patterns);
	}
}

async function collectFiles(
	ctx: DiscoveryContext,
	dir: string,
	filePattern: RegExp,
	skipNodeModules = true,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
): Promise<string[]> {
	const files: string[] = [];
	const root = rootDir ?? dir;
	if ((await stat(ctx, dir))?.kind !== "directory") return files;
	const matcher = ignoreMatcher ?? ignore();
	await addIgnoreRules(ctx, matcher, dir, root);
	for (const entry of await readDirectory(ctx, dir)) {
		checkAborted(ctx);
		if (entry.name.startsWith(".") || (skipNodeModules && entry.name === "node_modules")) continue;
		const fullPath = ctx.access.paths.join(dir, entry.name);
		const kind = await resolvedEntryKind(ctx, fullPath, entry);
		const relativePath = toPosixPath(ctx.access.paths.relative(root, fullPath));
		if (matcher.ignores(kind === "directory" ? `${relativePath}/` : relativePath)) continue;
		if (kind === "directory") {
			files.push(...(await collectFiles(ctx, fullPath, filePattern, skipNodeModules, matcher, root)));
		} else if (kind === "file" && filePattern.test(entry.name)) {
			files.push(fullPath);
		}
	}
	return files;
}

async function collectSkillEntries(
	ctx: DiscoveryContext,
	dir: string,
	includeRootFiles = true,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
): Promise<string[]> {
	const entries: string[] = [];
	const root = rootDir ?? dir;
	if ((await stat(ctx, dir))?.kind !== "directory") return entries;
	const matcher = ignoreMatcher ?? ignore();
	await addIgnoreRules(ctx, matcher, dir, root);
	for (const entry of await readDirectory(ctx, dir)) {
		checkAborted(ctx);
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const fullPath = ctx.access.paths.join(dir, entry.name);
		const kind = await resolvedEntryKind(ctx, fullPath, entry);
		const relativePath = toPosixPath(ctx.access.paths.relative(root, fullPath));
		if (matcher.ignores(kind === "directory" ? `${relativePath}/` : relativePath)) continue;
		if (kind === "directory") {
			entries.push(...(await collectSkillEntries(ctx, fullPath, false, matcher, root)));
		} else if (kind === "file" && ((includeRootFiles && entry.name.endsWith(".md")) || entry.name === "SKILL.md")) {
			entries.push(fullPath);
		}
	}
	return entries;
}

export function collectAutoSkillEntries(
	options: ResourceDiscoveryOptions,
	dir: string,
	includeRootFiles = true,
): Promise<string[]> {
	return collectSkillEntries(context(options), dir, includeRootFiles);
}

export async function collectAncestorAgentSkillEntries(
	options: ResourceDiscoveryOptions,
	cwd: string,
): Promise<string[]> {
	const ctx = context(options);
	const entries: string[] = [];
	let current = ctx.access.paths.resolve(cwd);
	while (true) {
		entries.push(...(await collectSkillEntries(ctx, ctx.access.paths.join(current, ".agents", "skills"), false)));
		if ((await stat(ctx, ctx.access.paths.join(current, ".git"))) !== undefined) break;
		const parent = ctx.access.paths.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return entries;
}

export async function collectAutoPromptEntries(options: ResourceDiscoveryOptions, dir: string): Promise<string[]> {
	const ctx = context(options);
	const entries: string[] = [];
	if ((await stat(ctx, dir))?.kind !== "directory") return entries;
	const matcher = ignore();
	await addIgnoreRules(ctx, matcher, dir, dir);
	for (const entry of await readDirectory(ctx, dir)) {
		checkAborted(ctx);
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const fullPath = ctx.access.paths.join(dir, entry.name);
		const kind = await resolvedEntryKind(ctx, fullPath, entry);
		if (
			!matcher.ignores(toPosixPath(ctx.access.paths.relative(dir, fullPath))) &&
			kind === "file" &&
			entry.name.endsWith(".md")
		) {
			entries.push(fullPath);
		}
	}
	return entries;
}

export function collectAutoThemeEntries(options: ResourceDiscoveryOptions, dir: string): Promise<string[]> {
	return collectTopLevelFiles(context(options), dir, ".json");
}

async function collectTopLevelFiles(ctx: DiscoveryContext, dir: string, suffix: string): Promise<string[]> {
	const entries: string[] = [];
	if ((await stat(ctx, dir))?.kind !== "directory") return entries;
	const matcher = ignore();
	await addIgnoreRules(ctx, matcher, dir, dir);
	for (const entry of await readDirectory(ctx, dir)) {
		checkAborted(ctx);
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const fullPath = ctx.access.paths.join(dir, entry.name);
		const kind = await resolvedEntryKind(ctx, fullPath, entry);
		if (
			!matcher.ignores(toPosixPath(ctx.access.paths.relative(dir, fullPath))) &&
			kind === "file" &&
			entry.name.endsWith(suffix)
		) {
			entries.push(fullPath);
		}
	}
	return entries;
}

export async function readResourceManifest(
	options: ResourceDiscoveryOptions,
	packageRoot: string,
): Promise<ResourceManifest | null> {
	const ctx = context(options);
	const content = await readText(ctx, ctx.access.paths.join(packageRoot, "package.json"));
	if (content === undefined) return null;
	try {
		const parsed = JSON.parse(content) as { pi?: unknown };
		return parsed.pi !== undefined && Value.Check(ResourceManifestSchema, parsed.pi) ? parsed.pi : null;
	} catch {
		return null;
	}
}

async function resolveExtensionEntries(ctx: DiscoveryContext, dir: string): Promise<string[] | null> {
	const options = { resourceAccess: ctx.access, signal: ctx.signal };
	const manifest = await readResourceManifest(options, dir);
	if (manifest?.extensions?.length) {
		const entries: string[] = [];
		for (const entry of manifest.extensions) {
			const path = ctx.access.paths.resolve(dir, entry);
			if ((await stat(ctx, path)) !== undefined) entries.push(path);
		}
		if (entries.length > 0) return entries;
	}
	const indexTs = ctx.access.paths.join(dir, "index.ts");
	if ((await stat(ctx, indexTs))?.kind === "file") return [indexTs];
	const indexJs = ctx.access.paths.join(dir, "index.js");
	if ((await stat(ctx, indexJs))?.kind === "file") return [indexJs];
	return null;
}

export async function collectAutoExtensionEntries(options: ResourceDiscoveryOptions, dir: string): Promise<string[]> {
	const ctx = context(options);
	if ((await stat(ctx, dir))?.kind !== "directory") return [];
	const rootEntries = await resolveExtensionEntries(ctx, dir);
	if (rootEntries) return rootEntries;
	const entries: string[] = [];
	const matcher = ignore();
	await addIgnoreRules(ctx, matcher, dir, dir);
	for (const entry of await readDirectory(ctx, dir)) {
		checkAborted(ctx);
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const fullPath = ctx.access.paths.join(dir, entry.name);
		const kind = await resolvedEntryKind(ctx, fullPath, entry);
		const relativePath = toPosixPath(ctx.access.paths.relative(dir, fullPath));
		if (matcher.ignores(kind === "directory" ? `${relativePath}/` : relativePath)) continue;
		if (kind === "file" && /\.(ts|js)$/.test(entry.name)) entries.push(fullPath);
		else if (kind === "directory") entries.push(...((await resolveExtensionEntries(ctx, fullPath)) ?? []));
	}
	return entries;
}

export async function collectResourceFiles(
	options: ResourceDiscoveryOptions,
	dir: string,
	resourceKind: ResourceKind,
): Promise<string[]> {
	if (resourceKind === "skills") return collectAutoSkillEntries(options, dir);
	if (resourceKind === "extensions") return collectAutoExtensionEntries(options, dir);
	return collectFiles(context(options), dir, FILE_PATTERNS[resourceKind]);
}
