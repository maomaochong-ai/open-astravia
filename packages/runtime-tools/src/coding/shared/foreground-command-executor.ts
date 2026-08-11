import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import {
	type CommandExecutionContextOptions,
	type CommandSpawnContext,
	prependPathCorrectionNotes,
	resolveCommandExecutionContext,
} from "./command-execution-context.js";
import type { CommandToolExecutor } from "./command-tool.js";
import {
	appendProtectedDirectoryWarning,
	type DirectorySnapshot,
	detectDirectoryChanges,
	snapshotDirectories,
} from "./protected-directory-changes.js";
import type { PathLiteralCorrection } from "./quoted-path-correction.js";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateTail } from "./truncation.js";

export const DEFAULT_COMMAND_BLOCK_UNTIL_SEC = 45;

export interface ForegroundCommandOperations {
	exec(
		command: string,
		cwd: string,
		options: {
			readonly onData: (data: Buffer) => void;
			readonly signal?: AbortSignal;
			readonly timeout?: number;
			readonly env?: NodeJS.ProcessEnv;
		},
	): Promise<{ readonly exitCode: number | null }>;
}

export interface ForegroundCommandExecutorOptions extends CommandExecutionContextOptions {
	readonly operations: ForegroundCommandOperations;
	readonly blockUntilSec?: number;
	readonly protectedDirectories?: readonly string[];
}

export interface ForegroundCommandToolDetails {
	readonly truncation?: TruncationResult;
	readonly fullOutputPath?: string;
	readonly pathCorrections?: readonly PathLiteralCorrection[];
}

export function createForegroundCommandToolExecutor(options: ForegroundCommandExecutorOptions): CommandToolExecutor {
	const blockUntilSec = options.blockUntilSec ?? DEFAULT_COMMAND_BLOCK_UNTIL_SEC;
	return {
		async execute(request) {
			if (request.input.run_in_background) {
				throw new Error(
					"Background execution is not available in this session. Run the command without run_in_background.",
				);
			}

			const { spawnContext, pathCorrections } = resolveCommandExecutionContext(
				request.input.command,
				request.cwd,
				options,
			);
			const protectedSnapshot = snapshotDirectories(options.protectedDirectories ?? []);
			const timeout = request.input.timeout ?? blockUntilSec;
			return executeForegroundCommand({
				operations: options.operations,
				spawnContext,
				timeout,
				usingDefaultTimeout: request.input.timeout === undefined,
				blockUntilSec,
				protectedDirectories: options.protectedDirectories ?? [],
				protectedSnapshot,
				pathCorrections,
				signal: request.signal,
				onUpdate: request.onUpdate,
			});
		},
	};
}

interface ExecuteForegroundCommandOptions {
	readonly operations: ForegroundCommandOperations;
	readonly spawnContext: CommandSpawnContext;
	readonly timeout: number;
	readonly usingDefaultTimeout: boolean;
	readonly blockUntilSec: number;
	readonly protectedDirectories: readonly string[];
	readonly protectedSnapshot: DirectorySnapshot;
	readonly pathCorrections: readonly PathLiteralCorrection[];
	readonly signal: AbortSignal;
	readonly onUpdate?: (result: RuntimeToolResult) => void;
}

function executeForegroundCommand(options: ExecuteForegroundCommandOptions): Promise<RuntimeToolResult> {
	return new Promise((resolve, reject) => {
		let tempFilePath: string | undefined;
		let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
		let totalBytes = 0;
		const chunks: Buffer[] = [];
		let chunksBytes = 0;
		const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

		const handleData = (data: Buffer) => {
			totalBytes += data.length;
			if (totalBytes > DEFAULT_MAX_BYTES && !tempFilePath) {
				tempFilePath = createTempOutputPath();
				tempFileStream = createWriteStream(tempFilePath);
				for (const chunk of chunks) tempFileStream.write(chunk);
			}
			if (tempFileStream) tempFileStream.write(data);

			chunks.push(data);
			chunksBytes += data.length;
			while (chunksBytes > maxChunksBytes && chunks.length > 1) {
				const removed = chunks.shift();
				if (!removed) break;
				chunksBytes -= removed.length;
			}

			if (options.onUpdate) {
				const truncation = truncateTail(decodeTextBuffer(Buffer.concat(chunks)));
				options.onUpdate({
					content: [{ type: "text", text: truncation.content || "" }],
					details: {
						truncation: truncation.truncated ? truncation : undefined,
						fullOutputPath: tempFilePath,
					},
				});
			}
		};

		options.operations
			.exec(options.spawnContext.command, options.spawnContext.cwd, {
				onData: handleData,
				signal: options.signal,
				timeout: options.timeout,
				env: options.spawnContext.env,
			})
			.then(({ exitCode }) => {
				tempFileStream?.end();
				const protectedChanges = detectDirectoryChanges(
					options.protectedSnapshot,
					snapshotDirectories(options.protectedDirectories),
				);
				const fullOutput = decodeTextBuffer(Buffer.concat(chunks));
				const truncation = truncateTail(fullOutput);
				let outputText = appendProtectedDirectoryWarning(truncation.content || "(no output)", protectedChanges);
				const details = createCommandDetails(truncation, tempFilePath, options.pathCorrections);
				outputText = appendTruncationNotice(outputText, truncation, fullOutput, tempFilePath);
				outputText = prependPathCorrectionNotes(outputText, options.pathCorrections);

				if (exitCode !== 0 && exitCode !== null) {
					reject(new Error(`${outputText}\n\nCommand exited with code ${exitCode}`));
					return;
				}
				resolve({ content: [{ type: "text", text: outputText }], details });
			})
			.catch((error: Error) => {
				tempFileStream?.end();
				let output = prependPathCorrectionNotes(decodeTextBuffer(Buffer.concat(chunks)), options.pathCorrections);
				if (error.message === "aborted") {
					if (output) output += "\n\n";
					reject(new Error(`${output}Command aborted`));
					return;
				}
				if (error.message.startsWith("timeout:")) {
					if (output) output += "\n\n";
					const seconds = error.message.split(":")[1];
					output += `Command timed out after ${seconds} seconds`;
					if (options.usingDefaultTimeout) {
						output +=
							`. Foreground commands without an explicit timeout are capped at ${options.blockUntilSec}s when background tasks are unavailable. ` +
							"For dev servers/watchers, enable background tasks and use run_in_background: true. " +
							"For long bounded work, pass a larger timeout.";
					}
					reject(new Error(output));
					return;
				}
				reject(error);
			});
	});
}

function createCommandDetails(
	truncation: TruncationResult,
	fullOutputPath: string | undefined,
	pathCorrections: readonly PathLiteralCorrection[],
): ForegroundCommandToolDetails | undefined {
	if (truncation.truncated) {
		return {
			truncation,
			fullOutputPath,
			...(pathCorrections.length > 0 ? { pathCorrections } : {}),
		};
	}
	return pathCorrections.length > 0 ? { pathCorrections } : undefined;
}

function appendTruncationNotice(
	text: string,
	truncation: TruncationResult,
	fullOutput: string,
	fullOutputPath: string | undefined,
): string {
	if (!truncation.truncated) return text;
	const startLine = truncation.totalLines - truncation.outputLines + 1;
	const endLine = truncation.totalLines;
	if (truncation.lastLinePartial) {
		const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
		return `${text}\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${fullOutputPath}]`;
	}
	if (truncation.truncatedBy === "lines") {
		return `${text}\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${fullOutputPath}]`;
	}
	return `${text}\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${fullOutputPath}]`;
}

function decodeTextBuffer(buffer: Buffer): string {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(buffer);
		return buffer.toString("utf-8");
	} catch {
		return new TextDecoder("gb18030").decode(buffer);
	}
}

function createTempOutputPath(): string {
	return join(tmpdir(), `pi-bash-${randomBytes(8).toString("hex")}.log`);
}

export type { CommandSpawnContext, CommandSpawnHook } from "./command-execution-context.js";
