import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import stripAnsi from "strip-ansi";
import { sanitizeBinaryOutput } from "../shared/text-decoding.js";
import { truncateTail } from "../shared/truncation.js";
import { killNodeProcessTree } from "./process-tree.js";

export interface NodeHostBashExecutionOptions {
	readonly onChunk?: (chunk: string) => void;
	readonly signal?: AbortSignal;
}

export interface NodeHostBashOperationOptions {
	readonly onData: (data: Buffer) => void;
	readonly signal?: AbortSignal;
	readonly timeout?: number;
	readonly env?: NodeJS.ProcessEnv;
}

export interface NodeHostBashOperations {
	exec(
		command: string,
		cwd: string,
		options: NodeHostBashOperationOptions,
	): Promise<{ readonly exitCode: number | null }>;
}

export interface NodeHostBashResult {
	readonly output: string;
	readonly exitCode: number | undefined;
	readonly cancelled: boolean;
	readonly truncated: boolean;
	readonly fullOutputPath?: string;
}

export interface NodeHostBashShell {
	readonly executable: string;
	readonly args: readonly string[];
	readonly commandPrefix?: string;
}

export interface NodeHostBashExecutorOptions {
	readonly resolveShell: () => NodeHostBashShell;
	readonly environment?: () => NodeJS.ProcessEnv;
	readonly workingDirectory?: () => string;
	readonly temporaryDirectory?: () => string;
}

export interface NodeHostBashExecutor {
	execute(command: string, options?: NodeHostBashExecutionOptions): Promise<NodeHostBashResult>;
	executeWithOperations(
		command: string,
		cwd: string,
		operations: NodeHostBashOperations,
		options?: NodeHostBashExecutionOptions,
	): Promise<NodeHostBashResult>;
}

const DEFAULT_MAX_BYTES = 50 * 1024;
const MAX_BUFFERED_BYTES = DEFAULT_MAX_BYTES * 2;

export function createNodeHostBashExecutor(options: NodeHostBashExecutorOptions): NodeHostBashExecutor {
	return {
		execute: (command, executionOptions) => executeLocal(command, options, executionOptions),
		executeWithOperations: (command, cwd, operations, executionOptions) =>
			executeWithOperations(command, cwd, operations, executionOptions, options),
	};
}

function executeLocal(
	command: string,
	options: NodeHostBashExecutorOptions,
	executionOptions?: NodeHostBashExecutionOptions,
): Promise<NodeHostBashResult> {
	const shell = options.resolveShell();
	const resolvedCommand = prependCommandPrefix(command, shell.commandPrefix);
	const cwd = options.workingDirectory?.() ?? process.cwd();
	const environment = options.environment?.() ?? process.env;

	return new Promise((resolve, reject) => {
		const child = spawn(shell.executable, [...shell.args, resolvedCommand], {
			cwd,
			detached: process.platform !== "win32",
			env: environment,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const output = new NodeBashOutputCollector(executionOptions, options.temporaryDirectory);
		const stop = () => {
			if (child.pid) killNodeProcessTree(child.pid);
			else child.kill();
		};
		const onAbort = () => stop();

		if (executionOptions?.signal?.aborted) {
			stop();
			output.close();
			resolve(output.finish(undefined, true));
			return;
		}
		executionOptions?.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout?.on("data", (data: Buffer) => output.accept(data));
		child.stderr?.on("data", (data: Buffer) => output.accept(data));
		child.once("error", (error) => {
			executionOptions?.signal?.removeEventListener("abort", onAbort);
			output.close();
			reject(error);
		});
		child.once("close", (code) => {
			executionOptions?.signal?.removeEventListener("abort", onAbort);
			resolve(output.finish(code ?? undefined, code === null || executionOptions?.signal?.aborted === true));
		});
	});
}

async function executeWithOperations(
	command: string,
	cwd: string,
	operations: NodeHostBashOperations,
	executionOptions: NodeHostBashExecutionOptions | undefined,
	options: NodeHostBashExecutorOptions,
): Promise<NodeHostBashResult> {
	const output = new NodeBashOutputCollector(executionOptions, options.temporaryDirectory);
	try {
		const result = await operations.exec(command, cwd, {
			onData: (data) => output.accept(data),
			signal: executionOptions?.signal,
		});
		return output.finish(result.exitCode ?? undefined, executionOptions?.signal?.aborted === true);
	} catch (error) {
		if (executionOptions?.signal?.aborted) return output.finish(undefined, true);
		output.close();
		throw error;
	}
}

function prependCommandPrefix(command: string, prefix: string | undefined): string {
	return prefix ? `${prefix}\n${command}` : command;
}

class NodeBashOutputCollector {
	private readonly decoder = new TextDecoder();
	private readonly outputChunks: string[] = [];
	private outputBytes = 0;
	private totalBytes = 0;
	private tempFilePath: string | undefined;
	private tempFileStream: WriteStream | undefined;

	constructor(
		private readonly options: NodeHostBashExecutionOptions | undefined,
		private readonly temporaryDirectory: (() => string) | undefined,
	) {}

	accept(data: Buffer): void {
		this.totalBytes += data.length;
		const text = sanitizeBinaryOutput(stripAnsi(this.decoder.decode(data, { stream: true }))).replace(/\r/g, "");
		if (this.totalBytes > DEFAULT_MAX_BYTES && !this.tempFilePath) {
			const directory = this.temporaryDirectory?.() ?? tmpdir();
			this.tempFilePath = join(directory, `pi-bash-${randomBytes(8).toString("hex")}.log`);
			this.tempFileStream = createWriteStream(this.tempFilePath);
			for (const chunk of this.outputChunks) this.tempFileStream.write(chunk);
		}
		this.tempFileStream?.write(text);
		this.outputChunks.push(text);
		this.outputBytes += text.length;
		while (this.outputBytes > MAX_BUFFERED_BYTES && this.outputChunks.length > 1) {
			const removed = this.outputChunks.shift();
			if (removed === undefined) break;
			this.outputBytes -= removed.length;
		}
		this.options?.onChunk?.(text);
	}

	finish(exitCode: number | undefined, cancelled: boolean): NodeHostBashResult {
		this.close();
		const fullOutput = this.outputChunks.join("");
		const truncated = truncateTail(fullOutput);
		return {
			output: truncated.content,
			exitCode: cancelled ? undefined : exitCode,
			cancelled,
			truncated: truncated.truncated,
			fullOutputPath: this.tempFilePath,
		};
	}

	close(): void {
		this.tempFileStream?.end();
	}
}
