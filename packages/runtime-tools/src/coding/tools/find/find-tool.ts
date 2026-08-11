import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, relative } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolExecutableResolver } from "../../host/executable-resolver.js";
import { resolveExistingPath } from "../../shared/path-resolution.js";
import { formatSize, type TruncationResult, truncateHead } from "../../shared/truncation.js";
import { FIND_TOOL_DESCRIPTION } from "./description.js";

const DEFAULT_LIMIT = 1000;
const IGNORE_PATTERNS = ["**/node_modules/**", "**/.git/**"];

export const FindToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

export type FindToolInput = Static<typeof FindToolInputSchema>;

export interface FindToolDetails {
	readonly truncation?: TruncationResult;
	readonly resultLimitReached?: number;
}

export interface FindOperations {
	readonly exists: (absolutePath: string) => Promise<boolean> | boolean;
	readonly glob: (
		pattern: string,
		cwd: string,
		options: { readonly ignore: readonly string[]; readonly limit: number },
	) => Promise<readonly string[]> | readonly string[];
}

export interface FindToolOptions {
	readonly operations?: FindOperations;
	readonly fdPath?: string;
	readonly executableResolver?: CodingToolExecutableResolver;
}

const defaultFindOperations: FindOperations = {
	exists: existsSync,
	glob: () => [],
};

export function createFindTool(cwd: string, options: FindToolOptions = {}): RuntimeToolDefinition<FindToolInput> {
	const operations = options.operations ?? defaultFindOperations;
	const fdPath = options.fdPath ?? "fd";

	return {
		name: "find",
		label: "find",
		description: FIND_TOOL_DESCRIPTION,
		inputSchema: FindToolInputSchema,
		async execute(request) {
			if (request.signal.aborted) throw new Error("Operation aborted");
			const searchPath = resolveExistingPath(request.input.path ?? ".", cwd);
			const limit = request.input.limit ?? DEFAULT_LIMIT;
			if (options.operations) {
				if (!(await operations.exists(searchPath))) {
					throw new Error(`Path not found: ${searchPath}`);
				}
				const results = await operations.glob(request.input.pattern, searchPath, {
					ignore: IGNORE_PATTERNS,
					limit,
				});
				return formatResults(results, searchPath, limit);
			}
			const resolvedFdPath = options.executableResolver ? await options.executableResolver.resolve("fd") : fdPath;
			if (!resolvedFdPath) {
				throw new Error("fd is not available and could not be downloaded");
			}
			return runFd({
				fdPath: resolvedFdPath,
				pattern: request.input.pattern,
				searchPath,
				limit,
				signal: request.signal,
			});
		},
	};
}

interface RunFdInput {
	readonly fdPath: string;
	readonly pattern: string;
	readonly searchPath: string;
	readonly limit: number;
	readonly signal: AbortSignal;
}

function runFd(input: RunFdInput): Promise<RuntimeToolResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			input.fdPath,
			["--glob", "--color=never", "--hidden", "--max-results", String(input.limit), input.pattern, input.searchPath],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		const output: string[] = [];
		let stderr = "";
		let aborted = false;
		const onAbort = () => {
			aborted = true;
			if (!child.killed) child.kill();
		};
		const cleanup = () => input.signal.removeEventListener("abort", onAbort);
		input.signal.addEventListener("abort", onAbort, { once: true });
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			output.push(...chunk.split(/\r?\n/).filter(Boolean));
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			cleanup();
			reject(new Error(`Failed to run fd: ${error.message}`));
		});
		child.on("close", (code) => {
			cleanup();
			if (aborted) {
				reject(new Error("Operation aborted"));
				return;
			}
			if (code !== 0 && code !== 1 && output.length === 0) {
				reject(new Error(stderr.trim() || `fd exited with code ${code}`));
				return;
			}
			void formatResults(output, input.searchPath, input.limit).then(resolve, reject);
		});
	});
}

async function formatResults(
	results: readonly string[],
	searchPath: string,
	limit: number,
): Promise<RuntimeToolResult> {
	if (results.length === 0) {
		return { content: [{ type: "text", text: "No files found matching pattern" }] };
	}

	const relativized = results.map((result) => {
		const line = result.trim();
		const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
		const relativePath = line.startsWith(searchPath) ? line.slice(searchPath.length + 1) : relative(searchPath, line);
		const normalized = relativePath.replace(/\\/g, "/");
		return hadTrailingSlash && !normalized.endsWith("/") ? `${normalized}/` : normalized || basename(line);
	});
	const resultLimitReached = relativized.length >= limit;
	const rawOutput = relativized.join("\n");
	const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
	let text = truncation.content;
	const details: { truncation?: TruncationResult; resultLimitReached?: number } = {};
	const notices: string[] = [];

	if (resultLimitReached) {
		notices.push(`${limit} results limit reached. Use limit=${limit * 2} for more, or refine pattern`);
		details.resultLimitReached = limit;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(50 * 1024)} limit reached`);
		details.truncation = truncation;
	}
	if (notices.length > 0) text += `\n\n[${notices.join(". ")}]`;
	return {
		content: [{ type: "text", text }],
		details: Object.keys(details).length > 0 ? details : undefined,
	};
}
