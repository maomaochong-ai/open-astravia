import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { BackgroundCommandService, BackgroundCommandSnapshot } from "./background-command-service.js";
import {
	type CommandExecutionContextOptions,
	prependPathCorrectionNotes,
	resolveCommandExecutionContext,
} from "./command-execution-context.js";
import type { CommandToolExecutor } from "./command-tool.js";
import { DEFAULT_COMMAND_BLOCK_UNTIL_SEC } from "./foreground-command-executor.js";
import {
	appendProtectedDirectoryWarning,
	detectDirectoryChanges,
	snapshotDirectories,
} from "./protected-directory-changes.js";
import type { PathLiteralCorrection } from "./quoted-path-correction.js";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateTail } from "./truncation.js";

export interface BackgroundCommandExecutorOptions extends CommandExecutionContextOptions {
	readonly foregroundExecutor: CommandToolExecutor;
	readonly backgroundService: BackgroundCommandService;
	readonly blockUntilSec?: number;
	readonly protectedDirectories?: readonly string[];
}

export interface BackgroundCommandToolDetails {
	readonly truncation?: TruncationResult;
	readonly fullOutputPath?: string;
	readonly backgroundTaskId?: string;
	readonly autoPromoted?: boolean;
	readonly pathCorrections?: readonly PathLiteralCorrection[];
}

export function createBackgroundCommandToolExecutor(options: BackgroundCommandExecutorOptions): CommandToolExecutor {
	const blockUntilSec = options.blockUntilSec ?? DEFAULT_COMMAND_BLOCK_UNTIL_SEC;
	return {
		async execute(request) {
			if (!request.input.run_in_background && request.input.timeout !== undefined) {
				return options.foregroundExecutor.execute(request);
			}

			const { spawnContext, pathCorrections } = resolveCommandExecutionContext(
				request.input.command,
				request.cwd,
				options,
			);

			if (request.input.run_in_background) {
				const task = options.backgroundService.spawn({
					command: spawnContext.command,
					cwd: spawnContext.cwd,
					env: spawnContext.env,
					toolCallId: request.toolCallId,
				});
				const text = prependPathCorrectionNotes(
					`Command running in background with task ID: ${task.id}\n` +
						`Output file: ${task.outputFile}\n` +
						"A <task-notification> will be delivered when the command finishes. " +
						"Use task_output to read incremental output, task_stop to terminate.",
					pathCorrections,
				);
				return {
					content: [{ type: "text", text }],
					details: {
						backgroundTaskId: task.id,
						fullOutputPath: task.outputFile,
						...(pathCorrections.length > 0 ? { pathCorrections } : {}),
					} satisfies BackgroundCommandToolDetails,
				};
			}

			const protectedDirectories = options.protectedDirectories ?? [];
			const protectedSnapshot = snapshotDirectories(protectedDirectories);
			const task = options.backgroundService.spawn({
				command: spawnContext.command,
				cwd: spawnContext.cwd,
				env: spawnContext.env,
				toolCallId: request.toolCallId,
				notifyOnlyIfPromoted: true,
			});
			const unsubscribe = subscribeToTaskUpdates(
				options.backgroundService,
				task.id,
				pathCorrections,
				request.onUpdate,
			);

			try {
				const { stillRunning, snapshot } = await options.backgroundService.wait(task.id, {
					maxMs: blockUntilSec * 1000,
					signal: request.signal,
				});
				const protectedChanges = detectDirectoryChanges(
					protectedSnapshot,
					snapshotDirectories(protectedDirectories),
				);

				if (stillRunning) {
					return createAutoPromotedResult(
						request.input.command,
						blockUntilSec,
						snapshot,
						pathCorrections,
						protectedChanges,
					);
				}

				const fullOutput = options.backgroundService.readOutput(snapshot.id, {
					fromStart: true,
					advanceCursor: false,
				});
				return createCompletedBackgroundResult(fullOutput, snapshot, pathCorrections, protectedChanges);
			} finally {
				unsubscribe();
			}
		},
	};
}

function subscribeToTaskUpdates(
	service: BackgroundCommandService,
	taskId: string,
	pathCorrections: readonly PathLiteralCorrection[],
	onUpdate: ((result: RuntimeToolResult) => void) | undefined,
): () => void {
	return service.subscribe((event) => {
		if (event.type === "tasks_cleared" || !onUpdate || event.task.id !== taskId) return;
		if (event.type !== "task_output" && event.type !== "task_ended") return;
		const truncation = truncateTail(event.task.tail || "");
		onUpdate({
			content: [{ type: "text", text: truncation.content || "" }],
			details: {
				backgroundTaskId: event.task.id,
				fullOutputPath: event.task.outputFile,
				...(pathCorrections.length > 0 ? { pathCorrections } : {}),
			} satisfies BackgroundCommandToolDetails,
		});
	});
}

function createAutoPromotedResult(
	command: string,
	blockUntilSec: number,
	task: BackgroundCommandSnapshot,
	pathCorrections: readonly PathLiteralCorrection[],
	protectedChanges: readonly string[],
): RuntimeToolResult {
	const partial = (task.tail || "").trim() || "(no output yet)";
	let text =
		`Command still running after ${blockUntilSec}s; auto-promoted to background task ${task.id}.\n` +
		`Command: ${command}\n` +
		`Partial output:\n${partial}\n` +
		`Full output file: ${task.outputFile}\n` +
		"Use task_output to read more, task_stop to terminate.\n" +
		"A <task-notification> will be delivered when it finishes.";
	text = appendProtectedDirectoryWarning(text, protectedChanges);
	text = prependPathCorrectionNotes(text, pathCorrections);
	return {
		content: [{ type: "text", text }],
		details: {
			backgroundTaskId: task.id,
			fullOutputPath: task.outputFile,
			autoPromoted: true,
			...(pathCorrections.length > 0 ? { pathCorrections } : {}),
		} satisfies BackgroundCommandToolDetails,
	};
}

function createCompletedBackgroundResult(
	fullOutput: string,
	task: BackgroundCommandSnapshot,
	pathCorrections: readonly PathLiteralCorrection[],
	protectedChanges: readonly string[],
): RuntimeToolResult {
	const truncation = truncateTail(fullOutput);
	let outputText = appendProtectedDirectoryWarning(truncation.content || "(no output)", protectedChanges);
	const fullOutputPath = truncation.truncated ? task.outputFile : undefined;
	let details: BackgroundCommandToolDetails | undefined;

	if (truncation.truncated) {
		details = {
			truncation,
			fullOutputPath,
			...(pathCorrections.length > 0 ? { pathCorrections } : {}),
		};
		const startLine = truncation.totalLines - truncation.outputLines + 1;
		const endLine = truncation.totalLines;
		if (truncation.lastLinePartial) {
			const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
			outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${fullOutputPath}]`;
		} else if (truncation.truncatedBy === "lines") {
			outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${fullOutputPath}]`;
		} else {
			outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${fullOutputPath}]`;
		}
	} else if (pathCorrections.length > 0) {
		details = { pathCorrections };
	}

	outputText = prependPathCorrectionNotes(outputText, pathCorrections);
	if (task.exitCode !== 0 && task.exitCode !== undefined) {
		throw new Error(`${outputText}\n\nCommand exited with code ${task.exitCode}`);
	}
	return { content: [{ type: "text", text: outputText }], details };
}
