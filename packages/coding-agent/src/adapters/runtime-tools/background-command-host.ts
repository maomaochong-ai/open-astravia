import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import stripAnsi from "strip-ansi";
import { sanitizeBinaryOutput } from "../../host/command-execution/command-output.js";
import { killProcessTree } from "../../host/command-execution/process-tree.js";
import {
	getDefaultShellCommandPrefix,
	getShellConfig,
	prependCommandPrefixes,
} from "../../host/command-execution/shell-runtime.js";

export interface RuntimeBackgroundCommandProcess {
	stop(): void;
}

export interface RuntimeSpawnBackgroundCommandProcessOptions {
	readonly command: string;
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly onOutput: (text: string) => void;
	readonly onExit: (exitCode: number | undefined) => void;
	readonly onError: (error: Error) => void;
}

export interface RuntimeBackgroundCommandProcessOperations {
	spawn(options: RuntimeSpawnBackgroundCommandProcessOptions): RuntimeBackgroundCommandProcess;
}

export interface RuntimeBackgroundCommandOutput {
	readonly path: string;
	append(text: string): void;
	read(offset: number): string;
	close(): void;
}

export interface RuntimeBackgroundCommandOutputStore {
	create(taskId: string): RuntimeBackgroundCommandOutput;
}

export interface CodingAgentBackgroundCommandHost {
	readonly processOperations: RuntimeBackgroundCommandProcessOperations;
	readonly outputStore: RuntimeBackgroundCommandOutputStore;
}

export function createCodingAgentBackgroundCommandHost(): CodingAgentBackgroundCommandHost {
	return {
		processOperations: localBackgroundCommandProcessOperations,
		outputStore: localBackgroundCommandOutputStore,
	};
}

const localBackgroundCommandProcessOperations: RuntimeBackgroundCommandProcessOperations = {
	spawn(options) {
		const { shell, args } = getShellConfig();
		const command = prependCommandPrefixes(options.command, [getDefaultShellCommandPrefix(shell)]);
		const child = spawn(shell, [...args, command], {
			cwd: options.cwd,
			detached: process.platform !== "win32",
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const decoder = new TextDecoder();
		const onData = (data: Buffer): void => {
			const text = sanitizeBinaryOutput(stripAnsi(decoder.decode(data, { stream: true }))).replace(/\r/g, "");
			if (text) options.onOutput(text);
		};

		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.on("close", (exitCode) => options.onExit(exitCode ?? undefined));
		child.on("error", options.onError);

		return {
			stop() {
				if (child.pid) {
					killProcessTree(child.pid);
				} else {
					child.kill();
				}
			},
		};
	},
};

const localBackgroundCommandOutputStore: RuntimeBackgroundCommandOutputStore = {
	create(taskId) {
		const path = join(tmpdir(), `vetta-task-${taskId}-${randomBytes(4).toString("hex")}.log`);
		const stream = createWriteStream(path);
		return {
			path,
			append: (text) => stream.write(text),
			read(offset) {
				return readFileSync(path).subarray(offset).toString("utf-8");
			},
			close: () => stream.end(),
		};
	},
};
