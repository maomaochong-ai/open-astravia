import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, getSceneDir, getUserSkillsDir } from "../../config.js";
import { killProcessTree } from "../../host/command-execution/process-tree.js";
import {
	getDefaultShellCommandPrefix,
	getShellConfig,
	getShellEnv,
	prependCommandPrefixes,
} from "../../host/command-execution/shell-runtime.js";

export interface RuntimeForegroundCommandOperations {
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

export interface CodingAgentForegroundCommandHost {
	readonly operations: RuntimeForegroundCommandOperations;
	readonly environment: () => NodeJS.ProcessEnv;
	readonly protectedDirectories: readonly string[];
}

export function createCodingAgentForegroundCommandHost(cwd: string): CodingAgentForegroundCommandHost {
	return {
		operations: localForegroundCommandOperations,
		environment: getShellEnv,
		protectedDirectories: [
			resolve(join(getAgentDir(), "skills")),
			resolve(getUserSkillsDir()),
			resolve(getSceneDir()),
			resolve(cwd, CONFIG_DIR_NAME, "skills"),
		],
	};
}

const localForegroundCommandOperations: RuntimeForegroundCommandOperations = {
	exec(command, cwd, { onData, signal, timeout, env }) {
		return new Promise((resolveExecution, rejectExecution) => {
			const { shell, args } = getShellConfig();

			if (!existsSync(cwd)) {
				rejectExecution(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
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
			let timeoutHandle: NodeJS.Timeout | undefined;

			if (timeout !== undefined && timeout > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					if (child.pid) killProcessTree(child.pid);
				}, timeout * 1000);
			}

			child.stdout?.on("data", onData);
			child.stderr?.on("data", onData);

			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			child.on("error", (error) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				signal?.removeEventListener("abort", onAbort);
				rejectExecution(error);
			});

			if (signal?.aborted) {
				onAbort();
			} else {
				signal?.addEventListener("abort", onAbort, { once: true });
			}

			child.on("close", (exitCode) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				signal?.removeEventListener("abort", onAbort);

				if (signal?.aborted) {
					rejectExecution(new Error("aborted"));
					return;
				}
				if (timedOut) {
					rejectExecution(new Error(`timeout:${timeout}`));
					return;
				}
				resolveExecution({ exitCode });
			});
		});
	},
};
