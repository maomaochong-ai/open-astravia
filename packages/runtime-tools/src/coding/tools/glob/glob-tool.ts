import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, sep } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { glob, globSync } from "glob";
import ignore from "ignore";
import { resolveExistingPath } from "../../shared/path-resolution.js";
import { formatSize, type TruncationResult, truncateHead } from "../../shared/truncation.js";
import { GLOB_TOOL_DESCRIPTION } from "./description.js";

const DEFAULT_LIMIT = 100;
const IGNORE_DIRECTORIES = ["**/.git/**"];

export const GlobToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	pattern: Type.String({
		description:
			"Glob pattern to match files and directories, e.g. '**/*.ts', 'src/**/*.spec.ts', 'src/**', or 'package*.json'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 100)" })),
});

export type GlobToolInput = Static<typeof GlobToolInputSchema>;

export interface GlobToolDetails {
	readonly durationMs: number;
	readonly numFiles: number;
	readonly truncation?: TruncationResult;
	readonly resultLimitReached?: number;
}

export interface GlobOperations {
	readonly isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
	readonly glob: (
		pattern: string,
		cwd: string,
		options: { readonly limit: number; readonly signal?: AbortSignal },
	) => Promise<readonly string[]> | readonly string[];
}

export interface GlobToolOptions {
	readonly operations?: GlobOperations;
}

const defaultGlobOperations: Pick<GlobOperations, "isDirectory"> = {
	isDirectory: (absolutePath) => statSync(absolutePath).isDirectory(),
};

interface IgnoreMatcher {
	readonly basePath: string;
	readonly ignores: ReturnType<typeof ignore>;
}

function extractGlobBaseDirectory(patternValue: string): { baseDir: string | undefined; relativePattern: string } {
	const firstGlobChar = patternValue.search(/[*?[{/]/);
	if (firstGlobChar === -1) {
		return { baseDir: dirname(patternValue), relativePattern: basename(patternValue) };
	}
	const staticPrefix = patternValue.slice(0, firstGlobChar);
	const lastSlash = Math.max(staticPrefix.lastIndexOf("/"), staticPrefix.lastIndexOf("\\"));
	if (lastSlash === -1) return { baseDir: undefined, relativePattern: patternValue };
	let baseDir = staticPrefix.slice(0, lastSlash);
	if (baseDir === "" && lastSlash === 0) baseDir = parse(patternValue).root || sep;
	if (process.platform === "win32" && /^[A-Za-z]:$/.test(baseDir)) baseDir += sep;
	return { baseDir, relativePattern: patternValue.slice(lastSlash + 1) };
}

function normalizeOutputPath(filePath: string, searchPath: string): string {
	const hadTrailingSlash = filePath.endsWith("/") || filePath.endsWith("\\");
	const absolute = isAbsolute(filePath) ? filePath : join(searchPath, filePath);
	const normalized = (relative(searchPath, absolute) || basename(absolute)).replace(/\\/g, "/");
	return hadTrailingSlash && !normalized.endsWith("/") ? `${normalized}/` : normalized;
}

function normalizeForIgnore(filePath: string): string {
	return filePath
		.replace(/\\/g, "/")
		.replace(/^\.\/+/, "")
		.replace(/^\/+/, "");
}

function loadGitignoreMatchers(searchPath: string): IgnoreMatcher[] {
	const paths = globSync("**/.gitignore", {
		cwd: searchPath,
		dot: true,
		absolute: true,
		ignore: IGNORE_DIRECTORIES,
		windowsPathsNoEscape: true,
	});
	const rootGitignore = join(searchPath, ".gitignore");
	if (existsSync(rootGitignore) && !paths.includes(rootGitignore)) paths.push(rootGitignore);
	return paths
		.map((gitignorePath) => ({
			basePath: dirname(gitignorePath),
			ignores: ignore().add(readFileSync(gitignorePath, "utf8")),
		}))
		.sort((left, right) => left.basePath.length - right.basePath.length);
}

function isIgnoredByGitignore(filePath: string, searchPath: string, matchers: readonly IgnoreMatcher[]): boolean {
	const hadTrailingSlash = filePath.endsWith("/") || filePath.endsWith("\\");
	const absolutePath = isAbsolute(filePath) ? filePath : join(searchPath, filePath);
	let ignored = false;
	for (const matcher of matchers) {
		const relativePath = relative(matcher.basePath, absolutePath);
		if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
		let normalized = normalizeForIgnore(relativePath);
		if (hadTrailingSlash && !normalized.endsWith("/")) normalized += "/";
		if (!normalized) continue;
		const result = matcher.ignores.test(normalized);
		if (result.ignored) ignored = true;
		else if (result.unignored) ignored = false;
	}
	return ignored;
}

async function runNodeGlob(patternValue: string, searchPath: string, limit: number, signal?: AbortSignal) {
	if (signal?.aborted) throw new Error("Operation aborted");
	const matchers = loadGitignoreMatchers(searchPath);
	const results: string[] = [];
	try {
		for await (const entry of glob.iterate(patternValue, {
			cwd: searchPath,
			dot: true,
			ignore: IGNORE_DIRECTORIES,
			mark: true,
			posix: true,
			signal,
			windowsPathsNoEscape: true,
		})) {
			if (isIgnoredByGitignore(entry, searchPath, matchers)) continue;
			results.push(entry);
			if (results.length >= limit) break;
		}
	} catch (error) {
		if (signal?.aborted) throw new Error("Operation aborted");
		throw error;
	}
	return results;
}

export function createGlobTool(cwd: string, options: GlobToolOptions = {}): RuntimeToolDefinition<GlobToolInput> {
	const customOps = options.operations;
	return {
		name: "glob",
		label: "glob",
		description: GLOB_TOOL_DESCRIPTION,
		inputSchema: GlobToolInputSchema,
		async execute(request) {
			const start = Date.now();
			let searchPath = resolveExistingPath(request.input.path ?? ".", cwd);
			let pattern = request.input.pattern;
			if (isAbsolute(pattern)) {
				const extracted = extractGlobBaseDirectory(pattern);
				if (extracted.baseDir) {
					searchPath = resolveExistingPath(extracted.baseDir, cwd);
					pattern = extracted.relativePattern;
				}
			}
			const operations = customOps ?? defaultGlobOperations;
			let isDirectory: boolean;
			try {
				isDirectory = await operations.isDirectory(searchPath);
			} catch {
				throw new Error(`Path not found: ${searchPath}`);
			}
			if (!isDirectory) throw new Error(`Not a directory: ${searchPath}`);
			const limit = Math.max(1, request.input.limit ?? DEFAULT_LIMIT);
			const rawResults = customOps
				? await customOps.glob(pattern, searchPath, { limit, signal: request.signal })
				: await runNodeGlob(pattern, searchPath, limit, request.signal);
			return formatResults(rawResults, searchPath, limit, start);
		},
	};
}

function formatResults(
	rawResults: readonly string[],
	searchPath: string,
	limit: number,
	start: number,
): RuntimeToolResult {
	const normalized = rawResults.map((filePath) => normalizeOutputPath(filePath, searchPath));
	const uniqueResults = Array.from(new Set(normalized));
	const limitedResults = uniqueResults.slice(0, limit);
	const truncation = truncateHead(limitedResults.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
	const details: { durationMs: number; numFiles: number; truncation?: TruncationResult; resultLimitReached?: number } =
		{
			durationMs: Date.now() - start,
			numFiles: limitedResults.length,
		};
	if (limitedResults.length === 0) {
		return {
			content: [{ type: "text", text: "No files or directories found matching pattern" }],
			details,
		};
	}
	let output = truncation.content;
	const notices: string[] = [];
	if (uniqueResults.length >= limit) {
		notices.push(`${limit} results limit reached. Use limit=${limit * 2} for more, or refine pattern`);
		details.resultLimitReached = limit;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(50 * 1024)} limit reached`);
		details.truncation = truncation;
	}
	if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
	return { content: [{ type: "text", text: output }], details };
}
