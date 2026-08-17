import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, relative } from "node:path";
import { createInterface } from "node:readline";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolExecutableResolver } from "../../host/executable-resolver.js";
import { anchorLineHash } from "../../shared/anchors.js";
import { resolveExistingPath } from "../../shared/path-resolution.js";
import { formatSize, type TruncationResult, truncateHead } from "../../shared/truncation.js";
import { GREP_TOOL_DESCRIPTION } from "./description.js";

const GREP_MAX_LINE_LENGTH = 500;
const DEFAULT_LIMIT = 100;

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
	readonly readFile: (absolutePath: string) => Promise<string> | string;
}

export interface GrepToolOptions {
	readonly operations?: GrepOperations;
	readonly rgPath?: string;
	readonly executableResolver?: CodingToolExecutableResolver;
}

interface RipgrepMatchEvent {
	readonly type?: unknown;
	readonly data?: {
		readonly path?: { readonly text?: unknown };
		readonly line_number?: unknown;
	};
}

const defaultGrepOperations: GrepOperations = {
	isDirectory: (absolutePath) => statSync(absolutePath).isDirectory(),
	readFile: (absolutePath) => readFileSync(absolutePath, "utf8"),
};

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
				throw new Error(`Path not found: ${searchPath}`);
			}

			const limit = Math.max(1, request.input.limit ?? DEFAULT_LIMIT);
			const context = request.input.context && request.input.context > 0 ? request.input.context : 0;
			const args = ["--json", "--line-number", "--color=never", "--hidden"];
			if (request.input.ignoreCase) args.push("--ignore-case");
			if (request.input.literal) args.push("--fixed-strings");
			if (request.input.glob) args.push("--glob", request.input.glob);
			args.push(request.input.pattern, searchPath);

			const resolvedRgPath = options.executableResolver ? await options.executableResolver.resolve("rg") : rgPath;
			if (!resolvedRgPath) {
				throw new Error("ripgrep (rg) is not available and could not be downloaded");
			}

			return runRipgrep({
				args,
				rgPath: resolvedRgPath,
				isDirectory,
				searchPath,
				operations,
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
	readonly operations: GrepOperations;
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
		const matches: Array<{ readonly filePath: string; readonly lineNumber: number }> = [];
		let stderr = "";
		let matchCount = 0;
		let matchLimitReached = false;
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

		input.signal.addEventListener("abort", onAbort, { once: true });
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		reader.on("line", (line) => {
			if (!line.trim() || matchCount >= input.limit) return;
			const event = parseMatchEvent(line);
			if (event?.type !== "match") return;
			const filePath = event.data?.path?.text;
			const lineNumber = event.data?.line_number;
			if (typeof filePath !== "string" || typeof lineNumber !== "number") return;
			matches.push({ filePath, lineNumber });
			matchCount += 1;
			if (matchCount >= input.limit) {
				matchLimitReached = true;
				stopChild(true);
			}
		});
		child.on("error", (error) => {
			cleanup();
			settle(() => reject(new Error(`Failed to run ripgrep: ${error.message}`)));
		});
		child.on("close", async (code) => {
			cleanup();
			if (aborted) {
				settle(() => reject(new Error("Operation aborted")));
				return;
			}
			if (!killedDueToLimit && code !== 0 && code !== 1) {
				settle(() => reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`)));
				return;
			}
			if (matches.length === 0) {
				settle(() => resolve({ content: [{ type: "text", text: "No matches found" }] }));
				return;
			}

			try {
				const output = await formatMatches(matches, input);
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
				if (output.split("\n").some((line) => line.includes("... [truncated]"))) {
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
			} catch (error) {
				settle(() => reject(error));
			}
		});
	});
}

function parseMatchEvent(line: string): RipgrepMatchEvent | undefined {
	try {
		const event: unknown = JSON.parse(line);
		if (!event || typeof event !== "object") return undefined;
		return event as RipgrepMatchEvent;
	} catch {
		return undefined;
	}
}

async function formatMatches(
	matches: readonly { readonly filePath: string; readonly lineNumber: number }[],
	input: RunRipgrepInput,
): Promise<string> {
	const cache = new Map<string, string[]>();
	const output: string[] = [];
	for (const match of matches) {
		const lines = cache.get(match.filePath) ?? (await readLines(input.operations, match.filePath, cache));
		const relativePath = input.isDirectory
			? relative(input.searchPath, match.filePath).replace(/\\/g, "/") || basename(match.filePath)
			: basename(match.filePath);
		if (lines.length === 0) {
			output.push(`${relativePath}:${match.lineNumber}: (unable to read file)`);
			continue;
		}
		const start = Math.max(1, match.lineNumber - input.context);
		const end = Math.min(lines.length, match.lineNumber + input.context);
		for (let lineNumber = start; lineNumber <= end; lineNumber++) {
			const original = lines[lineNumber - 1] ?? "";
			const { text } = truncateLine(original);
			const hash = anchorLineHash(original);
			if (lineNumber === match.lineNumber) {
				output.push(`${relativePath}:${lineNumber}:${hash}: ${text}`);
			} else {
				output.push(`${relativePath}-${lineNumber}:${hash}- ${text}`);
			}
		}
	}
	return output.join("\n");
}

async function readLines(
	operations: GrepOperations,
	filePath: string,
	cache: Map<string, string[]>,
): Promise<string[]> {
	try {
		const content = await operations.readFile(filePath);
		const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
		cache.set(filePath, lines);
		return lines;
	} catch {
		const lines: string[] = [];
		cache.set(filePath, lines);
		return lines;
	}
}

function truncateLine(line: string): { readonly text: string; readonly wasTruncated: boolean } {
	if (line.length <= GREP_MAX_LINE_LENGTH) return { text: line, wasTruncated: false };
	return {
		text: `${line.slice(0, GREP_MAX_LINE_LENGTH)}... [truncated]`,
		wasTruncated: true,
	};
}
