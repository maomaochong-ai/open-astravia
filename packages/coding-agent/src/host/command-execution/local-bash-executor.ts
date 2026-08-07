import { type ChildProcess, spawn } from "node:child_process";
import { BashOutputCollector } from "./bash-output-collector.js";
import type { HostBashExecutionOptions, HostBashResult } from "./contracts.js";
import { killProcessTree } from "./process-tree.js";
import { getDefaultShellCommandPrefix, getShellConfig, getShellEnv, prependCommandPrefixes } from "./shell-runtime.js";

export function executeLocalHostBash(command: string, options?: HostBashExecutionOptions): Promise<HostBashResult> {
	return new Promise((resolve, reject) => {
		const { shell, args } = getShellConfig();
		const resolvedCommand = prependCommandPrefixes(command, [getDefaultShellCommandPrefix(shell)]);
		const child: ChildProcess = spawn(shell, [...args, resolvedCommand], {
			detached: process.platform !== "win32",
			env: getShellEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		});
		const output = new BashOutputCollector(options);
		const abort = () => {
			if (child.pid) killProcessTree(child.pid);
		};

		if (options?.signal) {
			if (options.signal.aborted) {
				child.kill();
				output.close();
				resolve({ output: "", exitCode: undefined, cancelled: true, truncated: false });
				return;
			}
			options.signal.addEventListener("abort", abort, { once: true });
		}

		child.stdout?.on("data", (data: Buffer) => output.accept(data));
		child.stderr?.on("data", (data: Buffer) => output.accept(data));
		child.on("close", (code) => {
			options?.signal?.removeEventListener("abort", abort);
			resolve(output.finish(code ?? undefined, code === null));
		});
		child.on("error", (error) => {
			options?.signal?.removeEventListener("abort", abort);
			output.close();
			reject(error);
		});
	});
}
