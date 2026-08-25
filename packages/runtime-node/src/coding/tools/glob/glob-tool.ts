import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, sep } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { Minimatch } from "minimatch";
import type { CodingToolExecutableResolver } from "../../host/executable-resolver.js";
import { formatNotFoundPath, resolveExistingPath } from "../../shared/path-resolution.js";
import { formatSize, type TruncationResult, truncateHead } from "../../shared/truncation.js";
import { GLOB_TOOL_DESCRIPTION } from "./description.js";

const DEFAULT_LIMIT = 100;

/**
 * Metadata directories ripgrep would otherwise walk once `--hidden` is on. Excluding them
 * explicitly keeps the result identical in a plain directory and in a checkout, instead of
 * depending on ripgrep's git-aware defaults.
 */
const VCS_METADATA_DIRECTORIES = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"];

export const GlobToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	pattern: Type.String({
		description:
			"Glob pattern to match files, e.g. '**/*.ts', 'src/**/*.spec.ts', or 'package*.json'. Use '**/' to match at any depth; a bare '*.ts' only matches the top level.",
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
	readonly rgPath?: string;
	readonly executableResolver?: CodingToolExecutableResolver;
}

const defaultGlobOperations: Pick<GlobOperations, "isDirectory"> = {
	isDirectory: (absolutePath) => statSync(absolutePath).isDirectory(),
};

function extractGlobBaseDirectory(patternValue: string): { baseDir: string | undefined; relativePattern: string } {
	// `/` is a path separator, not a metacharacter: treating it as one makes every absolute
	// pattern look like it starts with a wildcard, leaving no static prefix to search under.
	const firstGlobChar = patternValue.search(/[*?[{]/);
	if (firstGlobChar === -1) {
		return { baseDir: dirname(patternValue), relativePattern: basename(patternValue) };
	}
	const staticPrefix = patternValue.slice(0, firstGlobChar);
	const lastSlash = Math.max(staticPrefix.lastIndexOf("/"), staticPrefix.lastIndexOf("\\"));
	if (lastSlash === -1) return { baseDir: undefined, relativePattern: patternValue };
	let baseDir = staticPrefix.slice(0, lastSlash);
	if (baseDir === "" && lastSlash === 0) baseDir = parse(patternValue).root || sep;
	if (process.platform === "win32" && /^[A-Za-z]:$/.test(baseDir)) baseDir += sep;
	const relativePattern = patternValue.slice(lastSlash + 1);
	return {
		baseDir,
		relativePattern: process.platform === "win32" ? relativePattern.replaceAll("\\", "/") : relativePattern,
	};
}

function normalizeOutputPath(filePath: string, searchPath: string): string {
	const absolute = isAbsolute(filePath) ? filePath : join(searchPath, filePath);
	return (relative(searchPath, absolute) || basename(absolute)).replace(/\\/g, "/");
}

/**
 * Builds the `rg --files` argv.
 *
 * The user's pattern is deliberately NOT passed as `--glob`: an inclusive `--glob` "always
 * overrides any other ignore logic" in ripgrep, so `**\/*.ts` would drag every ignored
 * `node_modules` and `dist` file back into the result. ripgrep therefore only produces the
 * ignore-respecting, recency-ordered candidate stream, and the pattern is matched here.
 * The remaining exclusive globs are safe — they can only remove entries, never resurrect them.
 */
function buildRipgrepFilesArgs(searchPath: string): string[] {
	// `--sortr=modified` puts the most recently touched files first, so a capped page is the
	// part of the tree that is actually in play rather than an arbitrary traversal prefix.
	// `--null` keeps paths unambiguous when a file name contains a newline.
	// `--no-require-git` keeps .gitignore authoritative outside a checkout too, which is what
	// the previous hand-rolled matcher did and what callers searching a plain directory expect.
	const args = ["--files", "--hidden", "--no-require-git", "--sortr=modified", "--null"];
	for (const directory of VCS_METADATA_DIRECTORIES) {
		args.push("--glob", `!${directory}/`);
	}
	args.push("--", searchPath);
	return args;
}

interface RipgrepFilesInput {
	readonly args: readonly string[];
	readonly rgPath: string;
	readonly limit: number;
	readonly signal: AbortSignal;
	/** Applied to each candidate path, already relative to the search root and posix-separated. */
	readonly accepts: (relativePath: string) => boolean;
	readonly toRelativePath: (absolutePath: string) => string;
}

interface RipgrepFilesResult {
	readonly paths: readonly string[];
	readonly limitReached: boolean;
}

/**
 * Runs `rg --files` and stops reading once one path past `limit` has arrived.
 *
 * Sorting happens inside ripgrep before the first byte is written, so the head of the stream
 * is already the final ordering — stopping early cannot change which paths would have won.
 */
function runRipgrepFiles(input: RipgrepFilesInput): Promise<RipgrepFilesResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(input.rgPath, input.args, { stdio: ["ignore", "pipe", "pipe"] });
		const paths: string[] = [];
		let pending = "";
		let stderr = "";
		let limitReached = false;
		let killedDueToLimit = false;
		let aborted = false;
		let settled = false;

		const settle = (callback: () => void) => {
			if (!settled) {
				settled = true;
				callback();
			}
		};
		const cleanup = () => input.signal.removeEventListener("abort", onAbort);
		const stopChild = (dueToLimit = false) => {
			killedDueToLimit = dueToLimit;
			if (!child.killed) child.kill();
		};
		function onAbort() {
			aborted = true;
			stopChild();
		}
		/** Records one candidate path; returns true once the stream can stop being read. */
		function accept(absolutePath: string): boolean {
			const relativePath = input.toRelativePath(absolutePath);
			if (!input.accepts(relativePath)) return false;
			paths.push(relativePath);
			// One extra match proves the result was capped without needing the rest of the stream.
			if (paths.length > input.limit) {
				limitReached = true;
				stopChild(true);
				return true;
			}
			return false;
		}

		input.signal.addEventListener("abort", onAbort, { once: true });
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.stdout.on("data", (chunk: Buffer) => {
			if (limitReached) return;
			pending += chunk.toString("utf8");
			let separator = pending.indexOf("\0");
			while (separator !== -1) {
				const entry = pending.slice(0, separator);
				pending = pending.slice(separator + 1);
				if (entry.length > 0 && accept(entry)) return;
				separator = pending.indexOf("\0");
			}
		});
		child.on("error", (error) => {
			cleanup();
			settle(() => reject(new Error(`Failed to run ripgrep: ${error.message}`)));
		});
		child.on("close", (code) => {
			cleanup();
			if (aborted) {
				settle(() => reject(new Error("Operation aborted")));
				return;
			}
			if (!killedDueToLimit) {
				if (pending.length > 0) accept(pending);
				// 0 = matches, 1 = no matches; anything else is a real failure.
				if (code !== 0 && code !== 1) {
					settle(() => reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`)));
					return;
				}
			}
			settle(() => resolve({ paths, limitReached }));
		});
	});
}

export function createGlobTool(cwd: string, options: GlobToolOptions = {}): RuntimeToolDefinition<GlobToolInput> {
	const customOps = options.operations;
	const rgPath = options.rgPath ?? "rg";

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
				throw new Error(formatNotFoundPath(searchPath, cwd));
			}
			if (!isDirectory) throw new Error(`Not a directory: ${searchPath}`);

			const limit = Math.max(1, request.input.limit ?? DEFAULT_LIMIT);
			if (customOps) {
				const rawResults = await customOps.glob(pattern, searchPath, { limit, signal: request.signal });
				return formatResults(rawResults, searchPath, limit, start, rawResults.length > limit);
			}

			if (request.signal.aborted) throw new Error("Operation aborted");
			const resolvedRgPath = options.executableResolver ? await options.executableResolver.resolve("rg") : rgPath;
			if (!resolvedRgPath) {
				throw new Error("ripgrep (rg) is not available and could not be downloaded");
			}
			const matcher = new Minimatch(pattern, { dot: true });
			const { paths, limitReached } = await runRipgrepFiles({
				args: buildRipgrepFilesArgs(searchPath),
				rgPath: resolvedRgPath,
				limit,
				signal: request.signal,
				accepts: (relativePath) => matcher.match(relativePath),
				toRelativePath: (absolutePath) => normalizeOutputPath(absolutePath, searchPath),
			});
			return formatResults(paths, searchPath, limit, start, limitReached);
		},
	};
}

function formatResults(
	rawResults: readonly string[],
	searchPath: string,
	limit: number,
	start: number,
	limitReached: boolean,
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
			content: [{ type: "text", text: "No files found matching pattern" }],
			details,
		};
	}
	let output = truncation.content;
	const notices: string[] = [];
	if (limitReached || uniqueResults.length > limit) {
		notices.push(
			`${limit} results limit reached, showing the ${limit} most recently modified. Use limit=${limit * 2} for more, or refine pattern`,
		);
		details.resultLimitReached = limit;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(50 * 1024)} limit reached`);
		details.truncation = truncation;
	}
	if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
	return { content: [{ type: "text", text: output }], details };
}
