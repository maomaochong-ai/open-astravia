import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { basename, relative } from "node:path";
import { createInterface } from "node:readline";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolExecutableResolver } from "../../host/executable-resolver.js";
import { anchorLineHash } from "../../shared/anchors.js";
import { formatNotFoundPath, resolveExistingPath } from "../../shared/path-resolution.js";
import {
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
	truncateHead,
	truncateLine,
} from "../../shared/truncation.js";
import { GREP_TOOL_DESCRIPTION } from "./description.js";

const DEFAULT_LIMIT = 100;

/** Kept in step with the glob tool so both searches see the same tree. */
const VCS_METADATA_DIRECTORIES = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"];

export const GrepToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(
		Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" }),
	),
	context: Type.Optional(
		Type.Number({ description: "Number of lines to show before and after each match (default: 0)" }),
	),
	filesOnly: Type.Optional(
		Type.Boolean({
			description: "Return only the paths of files containing a match, without the matching lines (default: false)",
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

export type GrepToolInput = Static<typeof GrepToolInputSchema>;

export interface GrepToolDetails {
	readonly truncation?: TruncationResult;
	readonly matchLimitReached?: number;
	readonly linesTruncated?: boolean;
}

export interface GrepOperations {
	readonly isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
}

export interface GrepToolOptions {
	readonly operations?: GrepOperations;
	readonly rgPath?: string;
	readonly executableResolver?: CodingToolExecutableResolver;
}

interface RipgrepLines {
	readonly text?: unknown;
	readonly bytes?: unknown;
}

interface RipgrepEvent {
	readonly type?: unknown;
	readonly data?: {
		readonly path?: { readonly text?: unknown };
		readonly lines?: RipgrepLines;
		readonly line_number?: unknown;
	};
}

interface GrepLine {
	readonly filePath: string;
	readonly lineNumber: number;
	readonly text: string;
	readonly isMatch: boolean;
}

const defaultGrepOperations: GrepOperations = {
	isDirectory: (absolutePath) => statSync(absolutePath).isDirectory(),
};

/**
 * Recovers a line's exact source text from a ripgrep event.
 *
 * Anchor hashes are computed from this string, so it must be the line as it exists on disk:
 * ripgrep switches from `text` to base64 `bytes` whenever a line is not valid UTF-8, and a
 * line reconstructed any other way would hash to an anchor the `edit` tool cannot resolve.
 */
function decodeEventLine(lines: RipgrepLines | undefined): string | undefined {
	if (typeof lines?.text === "string") return lines.text.replace(/\r?\n$/, "");
	if (typeof lines?.bytes === "string") {
		return Buffer.from(lines.bytes, "base64")
			.toString("utf8")
			.replace(/\r?\n$/, "");
	}
	return undefined;
}

export function createGrepTool(cwd: string, options: GrepToolOptions = {}): RuntimeToolDefinition<GrepToolInput> {
	const operations = options.operations ?? defaultGrepOperations;
	const rgPath = options.rgPath ?? "rg";

	return {
		name: "grep",
		label: "grep",
		description: GREP_TOOL_DESCRIPTION,
		inputSchema: GrepToolInputSchema,
		async execute(request) {
			if (request.signal.aborted) {
				throw new Error("Operation aborted");
			}

			const searchPath = resolveExistingPath(request.input.path ?? ".", cwd);
			let isDirectory: boolean;
			try {
				isDirectory = await operations.isDirectory(searchPath);
			} catch {
				throw new Error(formatNotFoundPath(searchPath, cwd));
			}

			const limit = Math.max(1, request.input.limit ?? DEFAULT_LIMIT);
			const filesOnly = request.input.filesOnly === true;
			const context = !filesOnly && request.input.context && request.input.context > 0 ? request.input.context : 0;
			const args = ["--line-number", "--color=never", "--hidden"];
			for (const directory of VCS_METADATA_DIRECTORIES) {
				args.push("--glob", `!${directory}/`);
			}
			// ripgrep owns context expansion; reconstructing it here would mean re-reading every
			// matched file just to slice the neighbouring lines back out.
			if (filesOnly) args.push("--files-with-matches");
			else args.push("--json");
			if (context > 0) args.push("--context", String(context));
			if (request.input.ignoreCase) args.push("--ignore-case");
			if (request.input.literal) args.push("--fixed-strings");
			if (request.input.glob) args.push("--glob", request.input.glob);
			args.push("--regexp", request.input.pattern, "--", searchPath);

			const resolvedRgPath = options.executableResolver ? await options.executableResolver.resolve("rg") : rgPath;
			if (!resolvedRgPath) {
				throw new Error("ripgrep (rg) is not available and could not be downloaded");
			}

			return runRipgrep({
				args,
				rgPath: resolvedRgPath,
				isDirectory,
				searchPath,
				filesOnly,
				context,
				limit,
				signal: request.signal,
			});
		},
	};
}

interface RunRipgrepInput {
	readonly args: readonly string[];
	readonly rgPath: string;
	readonly isDirectory: boolean;
	readonly searchPath: string;
	readonly filesOnly: boolean;
	readonly context: number;
	readonly limit: number;
	readonly signal: AbortSignal;
}

function runRipgrep(input: RunRipgrepInput): Promise<RuntimeToolResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(input.rgPath, input.args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const reader = createInterface({ input: child.stdout });
		const lines: GrepLine[] = [];
		const filePaths: string[] = [];
		let stderr = "";
		let matchCount = 0;
		let matchLimitReached = false;
		let done = false;
		let lastMatch: { filePath: string; lineNumber: number } | undefined;
		let killedDueToLimit = false;
		let aborted = false;
		let settled = false;

		const settle = (callback: () => void) => {
			if (!settled) {
				settled = true;
				callback();
			}
		};
		const cleanup = () => {
			reader.close();
			input.signal.removeEventListener("abort", onAbort);
		};
		const stopChild = (dueToLimit = false) => {
			killedDueToLimit = dueToLimit;
			if (!child.killed) child.kill();
		};
		const onAbort = () => {
			aborted = true;
			stopChild();
		};
		/** Stops reading once nothing further can be added to the output. */
		const finish = () => {
			done = true;
			stopChild(true);
		};

		input.signal.addEventListener("abort", onAbort, { once: true });
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		reader.on("line", (line) => {
			if (!line.trim() || done) return;

			if (input.filesOnly) {
				filePaths.push(line);
				matchCount += 1;
				if (matchCount >= input.limit) {
					matchLimitReached = true;
					finish();
				}
				return;
			}

			const event = parseEvent(line);
			const type = event?.type;
			if (type !== "match" && type !== "context") return;
			const filePath = event?.data?.path?.text;
			const lineNumber = event?.data?.line_number;
			const text = decodeEventLine(event?.data?.lines);
			if (typeof filePath !== "string" || typeof lineNumber !== "number" || text === undefined) return;

			if (matchCount >= input.limit) {
				// The limit is reached but ripgrep may still be emitting the trailing context of the
				// last accepted match. Take those lines and nothing else, so the final match keeps
				// the same surrounding window every earlier match got.
				const trailing =
					type === "context" &&
					lastMatch !== undefined &&
					filePath === lastMatch.filePath &&
					lineNumber <= lastMatch.lineNumber + input.context;
				if (!trailing) {
					finish();
					return;
				}
				lines.push({ filePath, lineNumber, text, isMatch: false });
				return;
			}

			lines.push({ filePath, lineNumber, text, isMatch: type === "match" });
			// Context lines ride along with their match; only matches count against the limit.
			if (type !== "match") return;
			lastMatch = { filePath, lineNumber };
			matchCount += 1;
			if (matchCount >= input.limit) matchLimitReached = true;
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
			if (!killedDueToLimit && code !== 0 && code !== 1) {
				settle(() => reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`)));
				return;
			}
			if (matchCount === 0) {
				settle(() =>
					resolve({ content: [{ type: "text", text: input.filesOnly ? "No files found" : "No matches found" }] }),
				);
				return;
			}

			const output = input.filesOnly
				? filePaths.map((filePath) => toRelativePath(filePath, input)).join("\n")
				: formatLines(lines, input);
			const details: {
				truncation?: TruncationResult;
				matchLimitReached?: number;
				linesTruncated?: boolean;
			} = {};
			const notices: string[] = [];
			const truncation = truncateHead(output);
			let text = truncation.content;

			if (matchLimitReached) {
				notices.push(
					`${input.limit} matches limit reached. Use limit=${input.limit * 2} for more, or refine pattern`,
				);
				details.matchLimitReached = input.limit;
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(50 * 1024)} limit reached`);
				details.truncation = truncation;
			}
			if (output.includes("... [truncated]")) {
				notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
				details.linesTruncated = true;
			}
			if (notices.length > 0) text += `\n\n[${notices.join(". ")}]`;
			settle(() =>
				resolve({
					content: [{ type: "text", text }],
					details: Object.keys(details).length > 0 ? details : undefined,
				}),
			);
		});
	});
}

function parseEvent(line: string): RipgrepEvent | undefined {
	try {
		const event: unknown = JSON.parse(line);
		if (!event || typeof event !== "object") return undefined;
		return event as RipgrepEvent;
	} catch {
		return undefined;
	}
}

function toRelativePath(filePath: string, input: Pick<RunRipgrepInput, "isDirectory" | "searchPath">): string {
	return input.isDirectory
		? relative(input.searchPath, filePath).replace(/\\/g, "/") || basename(filePath)
		: basename(filePath);
}

function formatLines(lines: readonly GrepLine[], input: RunRipgrepInput): string {
	return lines
		.map((line) => {
			const relativePath = toRelativePath(line.filePath, input);
			const { text } = truncateLine(line.text);
			// The hash must come from the untruncated line so it stays a valid `edit` anchor.
			const hash = anchorLineHash(line.text);
			return line.isMatch
				? `${relativePath}:${line.lineNumber}:${hash}: ${text}`
				: `${relativePath}-${line.lineNumber}:${hash}- ${text}`;
		})
		.join("\n");
}
