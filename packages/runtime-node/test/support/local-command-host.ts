import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	BackgroundCommandHost,
	ForegroundCommandOperations,
	SpawnBackgroundCommandProcessOptions,
} from "../../src/coding/index.js";

export function createTestForegroundCommandHost(cwd: string) {
	return {
		operations: localForegroundCommandOperations,
		environment: () => ({ ...process.env }),
		protectedDirectories: [resolve(cwd, ".vetta", "skills"), resolve(cwd, ".agents", "skills")],
	};
}

export function createTestBackgroundCommandHost(): BackgroundCommandHost {
	return {
		processOperations: {
			spawn: spawnBackgroundCommand,
		},
		outputStore: {
			create(taskId) {
				let content = "";
				return {
					path: join(tmpdir(), `runtime-tools-test-${taskId}.log`),
					append: (text) => {
						content += text;
					},
					read: (offset) => Buffer.from(content).subarray(offset).toString("utf8"),
					close: () => undefined,
				};
			},
		},
	};
}

const localForegroundCommandOperations: ForegroundCommandOperations = {
	exec(command, cwd, options) {
		return new Promise((resolveExecution, rejectExecution) => {
			const child = spawn(command, {
				cwd,
				env: options.env,
				shell: true,
				windowsHide: true,
			});
			let timedOut = false;
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			const stop = () => stopProcessTree(child);
			const onAbort = () => stop();

			if (options.timeout !== undefined && options.timeout > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					stop();
				}, options.timeout * 1_000);
			}
			child.stdout?.on("data", options.onData);
			child.stderr?.on("data", options.onData);
			child.once("error", rejectExecution);
			if (options.signal?.aborted) onAbort();
			else options.signal?.addEventListener("abort", onAbort, { once: true });
			child.once("close", (exitCode) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				options.signal?.removeEventListener("abort", onAbort);
				if (options.signal?.aborted) rejectExecution(new Error("aborted"));
				else if (timedOut) rejectExecution(new Error(`timeout:${options.timeout}`));
				else resolveExecution({ exitCode });
			});
		});
	},
};

function spawnBackgroundCommand(options: SpawnBackgroundCommandProcessOptions) {
	const child = spawn(options.command, {
		cwd: options.cwd,
		env: options.env,
		shell: true,
		windowsHide: true,
	});
	const decoder = new TextDecoder();
	const onData = (data: Buffer) => {
		const text = decoder.decode(data, { stream: true }).replaceAll("\r", "");
		if (text) options.onOutput(text);
	};
	child.stdout?.on("data", onData);
	child.stderr?.on("data", onData);
	child.once("close", (exitCode) => options.onExit(exitCode ?? undefined));
	child.once("error", options.onError);
	return { stop: () => stopProcessTree(child) };
}

function stopProcessTree(child: ChildProcess): void {
	if (process.platform === "win32" && child.pid !== undefined) {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
		return;
	}
	child.kill();
}
