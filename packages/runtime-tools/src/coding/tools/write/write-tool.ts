import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { resolveToCwd, resolveWritablePath } from "../../shared/path-resolution.js";
import { WRITE_TOOL_DESCRIPTION } from "./description.js";

export const WriteToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof WriteToolInputSchema>;

export interface WriteOperations {
	readonly writeFile: (absolutePath: string, content: string) => Promise<void>;
	readonly mkdir: (directory: string) => Promise<void>;
}

export interface WritePathPolicy {
	readonly getRejectionReason: (absolutePath: string) => string | undefined;
}

export interface WriteToolOptions {
	readonly operations?: WriteOperations;
	readonly pathPolicy: WritePathPolicy;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => writeFile(path, content, "utf-8"),
	mkdir: (directory) => mkdir(directory, { recursive: true }).then(() => {}),
};

export function createWriteTool(cwd: string, options: WriteToolOptions): RuntimeToolDefinition<WriteToolInput> {
	const operations = options.operations ?? defaultWriteOperations;
	const pathPolicy = options.pathPolicy;
	return {
		name: "write",
		label: "write",
		description: WRITE_TOOL_DESCRIPTION,
		inputSchema: WriteToolInputSchema,
		async execute(request) {
			const { path, content } = request.input;
			const requestedPath = resolveToCwd(path, cwd);
			const absolutePath = resolveWritablePath(path, cwd);
			const rejectionReason = pathPolicy.getRejectionReason(absolutePath);
			if (rejectionReason !== undefined) {
				return {
					content: [
						{
							type: "text",
							text: rejectionReason,
						},
					],
					details: undefined,
				};
			}

			const directory = dirname(absolutePath);
			const pathRetargeted = requestedPath !== absolutePath;
			const notes = pathRetargeted ? [`[Auto-corrected output path: "${path}" -> "${absolutePath}"]`] : [];
			return executeWrite({
				operations,
				directory,
				absolutePath,
				content,
				notes,
				signal: request.signal,
			});
		},
	};
}

interface ExecuteWriteOptions {
	readonly operations: WriteOperations;
	readonly directory: string;
	readonly absolutePath: string;
	readonly content: string;
	readonly notes: readonly string[];
	readonly signal: AbortSignal;
}

function executeWrite(options: ExecuteWriteOptions): Promise<{
	readonly content: readonly [{ readonly type: "text"; readonly text: string }];
	readonly details: undefined;
}> {
	return new Promise((resolve, reject) => {
		if (options.signal.aborted) {
			reject(new Error("Operation aborted"));
			return;
		}
		let aborted = false;
		const onAbort = (): void => {
			aborted = true;
			reject(new Error("Operation aborted"));
		};
		options.signal.addEventListener("abort", onAbort, { once: true });

		void (async () => {
			try {
				await options.operations.mkdir(options.directory);
				if (aborted) return;
				await options.operations.writeFile(options.absolutePath, options.content);
				if (aborted) return;
				options.signal.removeEventListener("abort", onAbort);
				resolve({
					content: [
						{
							type: "text",
							text:
								`${options.notes.join("\n")}${options.notes.length > 0 ? "\n" : ""}` +
								`Successfully wrote ${options.content.length} bytes to ${options.absolutePath}`,
						},
					],
					details: undefined,
				});
			} catch (error: unknown) {
				options.signal.removeEventListener("abort", onAbort);
				if (!aborted) reject(error);
			}
		})();
	});
}
