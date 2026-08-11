import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { CodingToolExecutableResolver } from "../../host/executable-resolver.js";
import { resolveExistingPath } from "../../shared/path-resolution.js";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "../../shared/truncation.js";
import { TREE_TOOL_DESCRIPTION } from "./description.js";
import { buildFdArgs, parseFdOutput, renderTreeOutput } from "./tree-model.js";

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_LIMIT = 1000;

export const TreeToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	path: Type.Optional(Type.String({ description: "Root directory to inspect (default: current directory)" })),
	maxDepth: Type.Optional(Type.Number({ description: "Maximum depth to render (default: 4)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of nodes to render (default: 1000)" })),
	includeFiles: Type.Optional(Type.Boolean({ description: "Include files in tree output (default: true)" })),
	includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden files and directories (default: false)" })),
	ignore: Type.Optional(
		Type.Array(Type.String({ description: "Additional fd --exclude glob pattern" }), {
			description: "Extra ignore patterns (appended to .gitignore rules)",
		}),
	),
});

export type TreeToolInput = Static<typeof TreeToolInputSchema>;

export interface TreeToolDetails {
	readonly truncation?: TruncationResult;
	readonly nodeLimitReached?: number;
	readonly scanLimitReached?: number;
	readonly totalNodesDiscovered: number;
	readonly nodesRendered: number;
}

export interface TreeOperations {
	readonly exists: (absolutePath: string) => Promise<boolean> | boolean;
	readonly stat: (
		absolutePath: string,
	) => Promise<{ readonly isDirectory: () => boolean }> | { readonly isDirectory: () => boolean };
	readonly runFd: (
		fdPath: string,
		args: readonly string[],
	) => Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }>;
}

export interface TreeToolOptions {
	readonly operations?: TreeOperations;
	readonly fdPath?: string;
	readonly executableResolver?: CodingToolExecutableResolver;
}

const defaultTreeOperations: TreeOperations = {
	exists: existsSync,
	stat: statSync,
	runFd: async (fdPath, args) => {
		const result = spawnSync(fdPath, args, { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 });
		return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
	},
};

export function createTreeTool(cwd: string, options: TreeToolOptions = {}): RuntimeToolDefinition<TreeToolInput> {
	const operations = options.operations ?? defaultTreeOperations;
	const fdPath = options.fdPath ?? "fd";
	return {
		name: "dir_tree",
		label: "dir_tree",
		description: TREE_TOOL_DESCRIPTION,
		inputSchema: TreeToolInputSchema,
		async execute(request) {
			if (request.signal.aborted) throw new Error("Operation aborted");
			const searchPath = resolveExistingPath(request.input.path ?? ".", cwd);
			const maxDepth = Math.max(0, Math.floor(request.input.maxDepth ?? DEFAULT_MAX_DEPTH));
			const limit = Math.max(1, Math.floor(request.input.limit ?? DEFAULT_LIMIT));
			const includeFiles = request.input.includeFiles ?? true;
			const includeHidden = request.input.includeHidden ?? false;
			const ignore = (request.input.ignore ?? []).filter((pattern) => pattern.trim().length > 0);
			const scanLimit = Math.max(limit * 4, 2000);

			if (!(await operations.exists(searchPath))) throw new Error(`Path not found: ${searchPath}`);
			const stats = await operations.stat(searchPath);
			if (!stats.isDirectory()) throw new Error(`Not a directory: ${searchPath}`);
			const resolvedFdPath = options.executableResolver ? await options.executableResolver.resolve("fd") : fdPath;
			if (!resolvedFdPath) throw new Error("fd is not available and could not be downloaded");

			const directoryResult = await operations.runFd(
				resolvedFdPath,
				buildFdArgs("dir", searchPath, maxDepth, scanLimit, includeHidden, ignore),
			);
			assertSuccessfulScan(directoryResult);
			let filePaths: string[] = [];
			if (includeFiles) {
				const fileResult = await operations.runFd(
					resolvedFdPath,
					buildFdArgs("file", searchPath, maxDepth, scanLimit, includeHidden, ignore),
				);
				assertSuccessfulScan(fileResult);
				filePaths = parseFdOutput(fileResult.stdout, searchPath);
			}

			const directoryPaths = parseFdOutput(directoryResult.stdout, searchPath);
			const rendered = renderTreeOutput(
				basename(searchPath) || searchPath,
				directoryPaths,
				filePaths,
				maxDepth,
				limit,
			);
			const truncation = truncateHead(rendered.rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
			const details: {
				truncation?: TruncationResult;
				nodeLimitReached?: number;
				scanLimitReached?: number;
				totalNodesDiscovered: number;
				nodesRendered: number;
			} = {
				totalNodesDiscovered: rendered.totalNodesDiscovered,
				nodesRendered: rendered.nodesRendered,
			};
			const notices: string[] = [];
			if (rendered.nodeLimitReached) {
				details.nodeLimitReached = limit;
				notices.push(`${limit} node limit reached`);
			}
			if (directoryPaths.length >= scanLimit || filePaths.length >= scanLimit) {
				details.scanLimitReached = scanLimit;
				notices.push(`${scanLimit} scan limit reached`);
			}
			if (truncation.truncated) {
				details.truncation = truncation;
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} output limit reached`);
			}

			let output = truncation.content;
			if (notices.length > 0) {
				output += `\n\n[${notices.join(". ")}. Narrow path or lower maxDepth for faster scans.]`;
			}
			return { content: [{ type: "text", text: output }], details };
		},
	};
}

function assertSuccessfulScan(result: { readonly status: number | null; readonly stderr: string }): void {
	if (result.status === 0) return;
	const error = result.stderr.trim() || `fd exited with code ${result.status}`;
	throw new Error(`Failed to build directory tree: ${error}`);
}
