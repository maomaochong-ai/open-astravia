import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { resolveExistingPath } from "../../shared/path-resolution.js";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "../../shared/truncation.js";
import { LS_TOOL_DESCRIPTION } from "./description.js";

export const LsToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
});

export type LsToolInput = Static<typeof LsToolInputSchema>;

export interface LsToolDetails {
	readonly truncation?: TruncationResult;
	readonly entryLimitReached?: number;
}

export interface LsStat {
	isDirectory(): boolean;
}

export interface LsOperations {
	exists(absolutePath: string): Promise<boolean> | boolean;
	stat(absolutePath: string): Promise<LsStat> | LsStat;
	readdir(absolutePath: string): Promise<string[]> | string[];
}

export interface LsToolOptions {
	readonly operations?: LsOperations;
}

const DEFAULT_LIMIT = 500;

const defaultLsOperations: LsOperations = {
	exists: existsSync,
	stat: statSync,
	readdir: readdirSync,
};

export function createLsTool(cwd: string, options: LsToolOptions = {}): RuntimeToolDefinition<LsToolInput> {
	const operations = options.operations ?? defaultLsOperations;

	return {
		name: "ls",
		label: "ls",
		description: LS_TOOL_DESCRIPTION,
		inputSchema: LsToolInputSchema,
		execute(request) {
			return new Promise<RuntimeToolResult>((resolve, reject) => {
				if (request.signal.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}

				const onAbort = () => reject(new Error("Operation aborted"));
				request.signal.addEventListener("abort", onAbort, { once: true });

				(async () => {
					try {
						const directoryPath = resolveExistingPath(request.input.path || ".", cwd);
						const effectiveLimit = request.input.limit ?? DEFAULT_LIMIT;

						if (!(await operations.exists(directoryPath))) {
							reject(new Error(`Path not found: ${directoryPath}`));
							return;
						}

						const directoryStat = await operations.stat(directoryPath);
						if (!directoryStat.isDirectory()) {
							reject(new Error(`Not a directory: ${directoryPath}`));
							return;
						}

						let entries: string[];
						try {
							entries = await operations.readdir(directoryPath);
						} catch (error) {
							reject(new Error(`Cannot read directory: ${legacyErrorMessage(error)}`));
							return;
						}

						entries.sort((first, second) => first.toLowerCase().localeCompare(second.toLowerCase()));

						const results: string[] = [];
						let entryLimitReached = false;

						for (const entry of entries) {
							if (results.length >= effectiveLimit) {
								entryLimitReached = true;
								break;
							}

							const entryPath = join(directoryPath, entry);
							let suffix = "";
							try {
								const entryStat = await operations.stat(entryPath);
								if (entryStat.isDirectory()) {
									suffix = "/";
								}
							} catch {
								continue;
							}
							results.push(entry + suffix);
						}

						request.signal.removeEventListener("abort", onAbort);

						if (results.length === 0) {
							resolve({
								content: [{ type: "text", text: "(empty directory)" }],
								details: undefined,
							});
							return;
						}

						const truncation = truncateHead(results.join("\n"), {
							maxLines: Number.MAX_SAFE_INTEGER,
						});
						let output = truncation.content;
						const notices: string[] = [];

						if (entryLimitReached) {
							notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
						}

						if (truncation.truncated) {
							notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
						}

						if (notices.length > 0) {
							output += `\n\n[${notices.join(". ")}]`;
						}

						const details: LsToolDetails | undefined =
							entryLimitReached || truncation.truncated
								? {
										...(entryLimitReached ? { entryLimitReached: effectiveLimit } : {}),
										...(truncation.truncated ? { truncation } : {}),
									}
								: undefined;
						resolve({
							content: [{ type: "text", text: output }],
							details,
						});
					} catch (error) {
						request.signal.removeEventListener("abort", onAbort);
						reject(error);
					}
				})();
			});
		},
	};
}

function legacyErrorMessage(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("message" in error)) {
		return undefined;
	}
	const message = error.message;
	return typeof message === "string" ? message : String(message);
}
