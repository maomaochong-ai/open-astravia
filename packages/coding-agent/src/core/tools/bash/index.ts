import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { CONFIG_DIR_NAME, getAgentDir, getAstraviaHomePath } from "../../../config.js";
import {
	decodeTextBuffer,
	getDefaultShellCommandPrefix,
	getShellConfig,
	getShellEnv,
	killProcessTree,
	prependCommandPrefixes,
} from "../../../utils/shell.js";
import type { BackgroundTaskManager } from "../../background-tasks/index.js";
import type { CodingAgentTool } from "../../session/tool-scope.js";
import { loadToolDescription } from "../description.js";
import { type PathLiteralCorrection, rewriteQuotedPathLiterals } from "../path-utils.js";
import { toolCallDescriptionSchema } from "../tool-call-description.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "../truncate.js";

/**
 * Soft wait (seconds) for foreground bash/shell when `timeout` is unset.
 * If the process is still running after this and BackgroundTaskManager is available,
 * the command is auto-promoted to a background task instead of blocking forever.
 * When background tasks are unavailable, this becomes a hard kill timeout.
 */
export const DEFAULT_BASH_BLOCK_UNTIL_SEC = 45;

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `pi-bash-${id}.log`);
}

// =============================================================================
// Protected directory change detection
// =============================================================================

/** Map of file path -> mtime in ms */
type DirSnapshot = Map<string, number>;

function getProtectedDirs(cwd: string): string[] {
	return [
		resolve(join(getAgentDir(), "skills")),
		resolve(join(getAstraviaHomePath(), "skills")),
		resolve(cwd, CONFIG_DIR_NAME, "skills"),
	].filter((dir) => existsSync(dir));
}

/** Recursively snapshot all files under a directory with their mtimes. */
function snapshotDir(dir: string): DirSnapshot {
	const snapshot: DirSnapshot = new Map();
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				for (const [k, v] of snapshotDir(fullPath)) {
					snapshot.set(k, v);
				}
			} else {
				try {
					snapshot.set(fullPath, statSync(fullPath).mtimeMs);
				} catch {
					// file may have been removed between readdir and stat
				}
			}
		}
	} catch {
		// directory not readable or doesn't exist
	}
	return snapshot;
}

function snapshotProtectedDirs(cwd: string): DirSnapshot {
	const combined: DirSnapshot = new Map();
	for (const dir of getProtectedDirs(cwd)) {
		for (const [k, v] of snapshotDir(dir)) {
			combined.set(k, v);
		}
	}
	return combined;
}

/** Compare before/after snapshots and return list of created/modified files. */
function detectProtectedChanges(before: DirSnapshot, after: DirSnapshot): string[] {
	const changed: string[] = [];
	for (const [filePath, mtime] of after) {
		const prevMtime = before.get(filePath);
		if (prevMtime === undefined || mtime > prevMtime) {
			changed.push(filePath);
		}
	}
	return changed;
}

const bashSchema = Type.Object({
	description: toolCallDescriptionSchema,
	command: Type.String({
		description: "Bash command to execute.",
	}),
	timeout: Type.Optional(
		Type.Number({
			description:
				"Hard timeout in seconds: kill the process when exceeded. Prefer for bounded work (builds, one-shot tests). Unrelated to auto-promote soft wait.",
		}),
	),
	run_in_background: Type.Optional(
		Type.Boolean({
			description:
				"Run as a background task immediately (returns task ID). REQUIRED for any process that does not exit on its own: dev servers, watchers, docker compose up (without -d), make dev, tunnels. Do not use for quick one-shot commands. Ignores timeout.",
		}),
	),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	pathCorrections?: PathLiteralCorrection[];
	/** Set when the command was started as a background task (explicit or auto-promoted). */
	backgroundTaskId?: string;
	/** True when a foreground command was auto-promoted after the soft wait. */
	autoPromoted?: boolean;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (e.g., SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command - The command to execute
	 * @param cwd - Working directory
	 * @param options - Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/**
 * Default bash operations using local shell
 */
const defaultBashOperations: BashOperations = {
	exec: (command, cwd, { onData, signal, timeout, env }) => {
		return new Promise((resolve, reject) => {
			const { shell, args } = getShellConfig();

			if (!existsSync(cwd)) {
				reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
				return;
			}

			const resolvedCommand = prependCommandPrefixes(command, [getDefaultShellCommandPrefix(shell)]);
			const child = spawn(shell, [...args, resolvedCommand], {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? getShellEnv(),
				stdio: ["ignore", "pipe", "pipe"],
			});

			let timedOut = false;

			// Set timeout if provided
			let timeoutHandle: NodeJS.Timeout | undefined;
			if (timeout !== undefined && timeout > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					if (child.pid) {
						killProcessTree(child.pid);
					}
				}, timeout * 1000);
			}

			// Stream stdout and stderr
			if (child.stdout) {
				child.stdout.on("data", onData);
			}
			if (child.stderr) {
				child.stderr.on("data", onData);
			}

			// Handle shell spawn errors
			child.on("error", (err) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
				reject(err);
			});

			// Handle abort signal - kill entire process tree
			const onAbort = () => {
				if (child.pid) {
					killProcessTree(child.pid);
				}
			};

			if (signal) {
				if (signal.aborted) {
					onAbort();
				} else {
					signal.addEventListener("abort", onAbort, { once: true });
				}
			}

			// Handle process exit
			child.on("close", (code) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);

				if (signal?.aborted) {
					reject(new Error("aborted"));
					return;
				}

				if (timedOut) {
					reject(new Error(`timeout:${timeout}`));
					return;
				}

				resolve({ exitCode: code });
			});
		});
	},
};

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

function prependPathCorrectionNotes(text: string, corrections: PathLiteralCorrection[]): string {
	if (corrections.length === 0) return text;
	const notes = corrections.map((c) => `[Auto-corrected path: "${c.original}" -> "${c.corrected}"]`).join("\n");
	return text ? `${notes}\n${text}` : notes;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

/** 宿主注入的 Agent Session ID 环境变量名。CLI 型能力（agent-browser 等）读取此值。 */
export const CODING_AGENT_SESSION_ID_ENV = "ASTRAVIA_AGENT_SESSION_ID";

/**
 * 创建 session 级命令环境变量 —— 和 open-vetta 的 createCodingAgentSessionCommandEnvironment 对应。
 *
 * 宿主在创建 Agent Session 时调此工厂，把 sessionId 注入 BashToolOptions.sessionEnv。
 * 这样 Agent 每次 bash 命令执行时都会自动带上 ASTRAVIA_AGENT_SESSION_ID。
 */
export function createSessionCommandEnvironment(
	sessionId: string,
	extra?: Readonly<Record<string, string>>,
): Record<string, string> {
	if (!sessionId.trim()) throw new Error("Coding Agent command environment requires a session id");
	return { ...extra, [CODING_AGENT_SESSION_ID_ENV]: sessionId };
}

function resolveSpawnContext(
	command: string,
	cwd: string,
	spawnHook?: BashSpawnHook,
	sessionEnv?: Readonly<Record<string, string>>,
): BashSpawnContext {
	const baseContext: BashSpawnContext = {
		command,
		cwd,
		env: { ...getShellEnv(), ...sessionEnv },
	};

	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (e.g., "shopt -s expand_aliases" for alias support) */
	commandPrefix?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/**
	 * Session-level environment variables injected into every bash command's env.
	 * 宿主用来注入 ASTRAVIA_AGENT_SESSION_ID —— 让 CLI 型能力（如 agent-browser）
	 * 能在多次短命令间复用自己的会话状态，而不是从 cwd 推导身份。
	 * 宿主值最后写入——如果 spawnHook 和 sessionEnv 都设置了同一个 key，
	 * spawnHook 的值覆盖 sessionEnv。
	 */
	sessionEnv?: Readonly<Record<string, string>>;
	/** Background task manager enabling run_in_background (local execution only) */
	backgroundTasks?: BackgroundTaskManager;
	/**
	 * Soft wait (seconds) before auto-promoting a foreground command to background
	 * when `timeout` is unset. Default {@link DEFAULT_BASH_BLOCK_UNTIL_SEC}.
	 * When background tasks are unavailable, this becomes a hard kill timeout.
	 */
	blockUntilSec?: number;
}

function readTaskLog(outputFile: string): string {
	try {
		return readFileSync(outputFile, "utf-8");
	} catch {
		return "";
	}
}

export function createBashTool(cwd: string, options?: BashToolOptions): CodingAgentTool<typeof bashSchema> {
	const ops = options?.operations ?? defaultBashOperations;
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	const sessionEnv = options?.sessionEnv;
	const backgroundTasks = options?.backgroundTasks;
	const blockUntilSec = options?.blockUntilSec ?? DEFAULT_BASH_BLOCK_UNTIL_SEC;
	// Custom ops (e.g. remote) cannot be adopted into the local BackgroundTaskManager.
	const canPromote = Boolean(backgroundTasks) && !options?.operations;
	const fallbackDescription = `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`;
	const description = loadToolDescription("bash", fallbackDescription);

	return {
		name: "bash",
		label: "bash",
		// win32 的默认命令工具是 shell：bash 置空 scope_use（注册但默认不激活），
		// 避免每轮同时下发 bash+shell 两份 schema；显式 tools 名单仍可强制启用。
		scope_use:
			process.platform === "win32"
				? []
				: ["im-claw", "conversation", "project", "batch", "automation", "kb-processing", "cli"],
		category: "core",
		description,
		parameters: bashSchema,
		execute: async (
			toolCallId: string,
			{ command, timeout, run_in_background }: { command: string; timeout?: number; run_in_background?: boolean },
			signal?: AbortSignal,
			onUpdate?,
		) => {
			// Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
			const resolvedCommand = prependCommandPrefixes(command, [commandPrefix]);
			const { output: correctedCommand, pathCorrections } = rewriteQuotedPathLiterals(resolvedCommand, cwd);
			const spawnContext = resolveSpawnContext(correctedCommand, cwd, spawnHook, sessionEnv);

			if (run_in_background) {
				if (!backgroundTasks) {
					throw new Error(
						"Background execution is not available in this session. Run the command without run_in_background.",
					);
				}
				if (options?.operations) {
					throw new Error(
						"Background execution is only supported for local commands. Run the command without run_in_background.",
					);
				}
				const task = backgroundTasks.spawn({
					command: spawnContext.command,
					cwd: spawnContext.cwd,
					env: spawnContext.env,
					toolCallId,
				});
				const text = prependPathCorrectionNotes(
					`Command running in background with task ID: ${task.id}\n` +
						`Output file: ${task.outputFile}\n` +
						`A <task-notification> will be delivered when the command finishes. ` +
						`Use task_output to read incremental output, task_stop to terminate.`,
					pathCorrections,
				);
				return {
					content: [{ type: "text", text }],
					details: {
						backgroundTaskId: task.id,
						fullOutputPath: task.outputFile,
						...(pathCorrections.length > 0 ? { pathCorrections } : {}),
					} satisfies BashToolDetails,
				};
			}

			// Snapshot protected directories before execution
			const protectedSnapshot = snapshotProtectedDirs(cwd);

			// ── Soft wait → auto-promote (local + BTM, no hard timeout) ───────────
			// Spawns via BackgroundTaskManager so a process that outlives blockUntilSec
			// is handed off without killing. Commands that exit within the wait return
			// inline (no <task-notification>).
			if (timeout === undefined && canPromote && backgroundTasks) {
				const task = backgroundTasks.spawn({
					command: spawnContext.command,
					cwd: spawnContext.cwd,
					env: spawnContext.env,
					toolCallId,
					notifyOnlyIfPromoted: true,
				});

				const unsub = backgroundTasks.subscribe((event) => {
					if (event.type === "tasks_cleared" || !onUpdate) return;
					if (event.task.id !== task.id) return;
					if (event.type === "task_output" || event.type === "task_ended") {
						const truncation = truncateTail(event.task.tail || "");
						onUpdate({
							content: [{ type: "text", text: truncation.content || "" }],
							details: {
								backgroundTaskId: task.id,
								fullOutputPath: event.task.outputFile,
								...(pathCorrections.length > 0 ? { pathCorrections } : {}),
							} satisfies BashToolDetails,
						});
					}
				});

				try {
					const { stillRunning, snapshot } = await backgroundTasks.wait(task.id, {
						maxMs: blockUntilSec * 1000,
						signal,
					});

					const afterSnapshot = snapshotProtectedDirs(cwd);
					const protectedChanges = detectProtectedChanges(protectedSnapshot, afterSnapshot);

					if (stillRunning) {
						const partial = (snapshot.tail || "").trim() || "(no output yet)";
						let text =
							`Command still running after ${blockUntilSec}s; auto-promoted to background task ${snapshot.id}.\n` +
							`Command: ${command}\n` +
							`Partial output:\n${partial}\n` +
							`Full output file: ${snapshot.outputFile}\n` +
							`Use task_output to read more, task_stop to terminate.\n` +
							`A <task-notification> will be delivered when it finishes.`;
						if (protectedChanges.length > 0) {
							const fileList = protectedChanges.map((f) => `  - ${f}`).join("\n");
							text +=
								`\n\n⚠ WARNING: The following files inside skill directories were created or modified by this command:\n` +
								`${fileList}\n` +
								`Skill directories are READ-ONLY. Move these output files to the user's working directory (cwd) immediately ` +
								`and delete the copies from the skill directory.`;
						}
						text = prependPathCorrectionNotes(text, pathCorrections);
						return {
							content: [{ type: "text", text }],
							details: {
								backgroundTaskId: snapshot.id,
								fullOutputPath: snapshot.outputFile,
								autoPromoted: true,
								...(pathCorrections.length > 0 ? { pathCorrections } : {}),
							} satisfies BashToolDetails,
						};
					}

					// Completed within soft wait — same formatting as hard foreground path
					const fullOutput = readTaskLog(snapshot.outputFile);
					const truncation = truncateTail(fullOutput);
					let outputText = truncation.content || "(no output)";
					const tempFilePath = truncation.truncated ? snapshot.outputFile : undefined;

					if (protectedChanges.length > 0) {
						const fileList = protectedChanges.map((f) => `  - ${f}`).join("\n");
						outputText +=
							`\n\n⚠ WARNING: The following files inside skill directories were created or modified by this command:\n` +
							`${fileList}\n` +
							`Skill directories are READ-ONLY. Move these output files to the user's working directory (cwd) immediately ` +
							`and delete the copies from the skill directory.`;
					}

					let details: BashToolDetails | undefined;
					const hasPathCorrections = pathCorrections.length > 0;
					if (truncation.truncated) {
						details = {
							truncation,
							fullOutputPath: tempFilePath,
							...(hasPathCorrections ? { pathCorrections } : {}),
						};
						const startLine = truncation.totalLines - truncation.outputLines + 1;
						const endLine = truncation.totalLines;
						if (truncation.lastLinePartial) {
							const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
							outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
						} else if (truncation.truncatedBy === "lines") {
							outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
						} else {
							outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
						}
					}
					if (!details && hasPathCorrections) {
						details = { pathCorrections };
					}
					outputText = prependPathCorrectionNotes(outputText, pathCorrections);

					const exitCode = snapshot.exitCode ?? null;
					if (exitCode !== 0 && exitCode !== null) {
						outputText += `\n\nCommand exited with code ${exitCode}`;
						throw new Error(outputText);
					}
					return { content: [{ type: "text", text: outputText }], details };
				} finally {
					unsub();
				}
			}

			// Hard timeout: explicit timeout, or default blockUntilSec when promote is unavailable
			const hardTimeout = timeout !== undefined ? timeout : !canPromote ? blockUntilSec : undefined;
			const usingDefaultHardTimeout = timeout === undefined && !canPromote;

			return new Promise((resolve, reject) => {
				// We'll stream to a temp file if output gets large
				let tempFilePath: string | undefined;
				let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
				let totalBytes = 0;

				// Keep a rolling buffer of the last chunk for tail truncation
				const chunks: Buffer[] = [];
				let chunksBytes = 0;
				// Keep more than we need so we have enough for truncation
				const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

				const handleData = (data: Buffer) => {
					totalBytes += data.length;

					// Start writing to temp file once we exceed the threshold
					if (totalBytes > DEFAULT_MAX_BYTES && !tempFilePath) {
						tempFilePath = getTempFilePath();
						tempFileStream = createWriteStream(tempFilePath);
						// Write all buffered chunks to the file
						for (const chunk of chunks) {
							tempFileStream.write(chunk);
						}
					}

					// Write to temp file if we have one
					if (tempFileStream) {
						tempFileStream.write(data);
					}

					// Keep rolling buffer of recent data
					chunks.push(data);
					chunksBytes += data.length;

					// Trim old chunks if buffer is too large
					while (chunksBytes > maxChunksBytes && chunks.length > 1) {
						const removed = chunks.shift()!;
						chunksBytes -= removed.length;
					}

					// Stream partial output to callback (truncated rolling buffer)
					if (onUpdate) {
						const fullBuffer = Buffer.concat(chunks);
						const fullText = decodeTextBuffer(fullBuffer);
						const truncation = truncateTail(fullText);
						onUpdate({
							content: [{ type: "text", text: truncation.content || "" }],
							details: {
								truncation: truncation.truncated ? truncation : undefined,
								fullOutputPath: tempFilePath,
							},
						});
					}
				};

				ops.exec(spawnContext.command, spawnContext.cwd, {
					onData: handleData,
					signal,
					timeout: hardTimeout,
					env: spawnContext.env,
				})
					.then(({ exitCode }) => {
						// Close temp file stream
						if (tempFileStream) {
							tempFileStream.end();
						}

						// Detect writes to protected skill directories
						const afterSnapshot = snapshotProtectedDirs(cwd);
						const protectedChanges = detectProtectedChanges(protectedSnapshot, afterSnapshot);

						// Combine all buffered chunks
						const fullBuffer = Buffer.concat(chunks);
						const fullOutput = decodeTextBuffer(fullBuffer);

						// Apply tail truncation
						const truncation = truncateTail(fullOutput);
						let outputText = truncation.content || "(no output)";

						// Append warning if protected files were modified
						if (protectedChanges.length > 0) {
							const fileList = protectedChanges.map((f) => `  - ${f}`).join("\n");
							outputText +=
								`\n\n⚠ WARNING: The following files inside skill directories were created or modified by this command:\n` +
								`${fileList}\n` +
								`Skill directories are READ-ONLY. Move these output files to the user's working directory (cwd) immediately ` +
								`and delete the copies from the skill directory.`;
						}

						// Build details with truncation info
						let details: BashToolDetails | undefined;
						const hasPathCorrections = pathCorrections.length > 0;

						if (truncation.truncated) {
							details = {
								truncation,
								fullOutputPath: tempFilePath,
								...(hasPathCorrections ? { pathCorrections } : {}),
							};

							// Build actionable notice
							const startLine = truncation.totalLines - truncation.outputLines + 1;
							const endLine = truncation.totalLines;

							if (truncation.lastLinePartial) {
								// Edge case: last line alone > 30KB
								const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
								outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
							} else if (truncation.truncatedBy === "lines") {
								outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
							} else {
								outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
							}
						}
						if (!details && hasPathCorrections) {
							details = { pathCorrections };
						}
						outputText = prependPathCorrectionNotes(outputText, pathCorrections);

						if (exitCode !== 0 && exitCode !== null) {
							outputText += `\n\nCommand exited with code ${exitCode}`;
							reject(new Error(outputText));
						} else {
							resolve({ content: [{ type: "text", text: outputText }], details });
						}
					})
					.catch((err: Error) => {
						// Close temp file stream
						if (tempFileStream) {
							tempFileStream.end();
						}

						// Combine all buffered chunks for error output
						const fullBuffer = Buffer.concat(chunks);
						let output = decodeTextBuffer(fullBuffer);
						output = prependPathCorrectionNotes(output, pathCorrections);

						if (err.message === "aborted") {
							if (output) output += "\n\n";
							output += "Command aborted";
							reject(new Error(output));
						} else if (err.message.startsWith("timeout:")) {
							const timeoutSecs = err.message.split(":")[1];
							if (output) output += "\n\n";
							output += `Command timed out after ${timeoutSecs} seconds`;
							if (usingDefaultHardTimeout) {
								output +=
									`. Foreground commands without an explicit timeout are capped at ${blockUntilSec}s when background tasks are unavailable. ` +
									`For dev servers/watchers, enable background tasks and use run_in_background: true. ` +
									`For long bounded work, pass a larger timeout.`;
							}
							reject(new Error(output));
						} else {
							reject(err);
						}
					});
			});
		},
	};
}

/** Default bash tool using process.cwd() - for backwards compatibility */
export const bashTool = createBashTool(process.cwd());
