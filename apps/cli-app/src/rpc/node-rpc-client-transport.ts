import { type ChildProcess, spawn } from "node:child_process";
import * as readline from "node:readline";
import {
	RPC_FAILURE_CODES,
	RpcClientError,
	type RpcClientTransport,
	type RpcClientTransportHandlers,
} from "@vetta/coding-agent/rpc";

const RPC_CLIENT_STARTUP_SETTLE_MS = 100;
const RPC_CLIENT_STOP_GRACE_MS = 1_000;

export interface NodeRpcClientTransportOptions {
	/** Path to a JavaScript CLI entry point. Defaults to the installed `vetta-agent-rpc` executable. */
	readonly cliPath?: string;
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly provider?: string;
	readonly model?: string;
	readonly args?: readonly string[];
}

export interface RpcClientProcessLaunch {
	readonly command: string;
	readonly args: readonly string[];
}

export function resolveRpcClientProcessLaunch(
	cliPath: string | undefined,
	args: readonly string[],
): RpcClientProcessLaunch {
	return cliPath ? { command: "node", args: [cliPath, ...args] } : { command: "vetta-agent-rpc", args: [...args] };
}

export class NodeRpcClientTransport implements RpcClientTransport {
	private process: ChildProcess | null = null;
	private reader: readline.Interface | null = null;
	private stderr = "";
	private stopping = false;

	constructor(private readonly options: NodeRpcClientTransportOptions = {}) {}

	async start(handlers: RpcClientTransportHandlers): Promise<void> {
		if (this.process) {
			throw new RpcClientError("Client transport already started", {
				errorCode: RPC_FAILURE_CODES.INVALID_REQUEST,
				phase: "startup",
				recoverability: "user_action",
			});
		}
		this.stderr = "";
		this.stopping = false;
		const launch = resolveRpcClientProcessLaunch(this.options.cliPath, createRpcArguments(this.options));
		const child = spawn(launch.command, launch.args, {
			cwd: this.options.cwd,
			env: { ...process.env, ...this.options.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.process = child;
		child.once("exit", (code, signal) => {
			if (this.process !== child) return;
			this.process = null;
			this.reader?.close();
			this.reader = null;
			if (this.stopping) return;
			const suffix = signal ? ` signal ${signal}` : ` code ${code ?? "unknown"}`;
			handlers.onFailure(
				new RpcClientError(`Agent process exited with${suffix}. Stderr: ${this.stderr}`, {
					errorCode: RPC_FAILURE_CODES.PROCESS_EXITED,
					phase: "command",
					recoverability: "restart_session",
				}),
			);
		});
		child.stderr?.on("data", (data) => {
			this.stderr += data.toString();
		});
		this.reader = readline.createInterface({
			input: child.stdout!,
			terminal: false,
		});
		this.reader.on("line", handlers.onLine);

		try {
			await waitForSpawn(child);
		} catch (error) {
			this.reader?.close();
			this.reader = null;
			this.process = null;
			throw error;
		}
	}

	async stop(): Promise<void> {
		const child = this.process;
		if (!child) return;
		this.stopping = true;
		this.reader?.close();
		child.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				child.kill("SIGKILL");
				resolve();
			}, RPC_CLIENT_STOP_GRACE_MS);
			child.once("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
		if (this.process === child) this.process = null;
		this.reader = null;
	}

	write(line: string): void {
		if (!this.process?.stdin) {
			throw new RpcClientError("Client not started", {
				errorCode: RPC_FAILURE_CODES.CLIENT_NOT_STARTED,
				phase: "command",
				recoverability: "user_action",
			});
		}
		this.process.stdin.write(line);
	}

	getStderr(): string {
		return this.stderr;
	}
}

function createRpcArguments(options: NodeRpcClientTransportOptions): string[] {
	const args = ["--mode", "rpc"];
	if (options.provider) args.push("--provider", options.provider);
	if (options.model) args.push("--model", options.model);
	if (options.args) args.push(...options.args);
	return args;
}

function waitForSpawn(child: ChildProcess): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (cause: Error): void => {
			clearTimeout(timer);
			reject(
				new RpcClientError(
					`Failed to spawn Agent process: ${cause.message}`,
					{
						errorCode: RPC_FAILURE_CODES.PROCESS_SPAWN_FAILED,
						phase: "startup",
						recoverability: "retry_safe",
					},
					{ cause },
				),
			);
		};
		const timer = setTimeout(() => {
			child.removeListener("error", onError);
			resolve();
		}, RPC_CLIENT_STARTUP_SETTLE_MS);
		child.once("error", onError);
	});
}
