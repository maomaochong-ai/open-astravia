import type { ChildProcess } from "node:child_process";
import type {
	InstalledPlugin,
	PluginCommandRunOptions,
	PluginCommandRunResult,
} from "../../preload/api-types/plugins.js";
import { getAppLogger } from "../logger.js";
import { createPluginCommandEnvironment } from "./command-environment.js";
import { spawnCrossPlatformCommand } from "./command-launcher.js";
import { listPlugins } from "./plugin-catalog.js";

const commandLog = getAppLogger("plugin");

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB stdout/stderr cap

function hasGrantedPermission(plugin: InstalledPlugin, permission: "agent.command.run"): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}

function clampTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
	return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

function sanitizeArgs(args: unknown): string[] {
	if (args === undefined) return [];
	if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
		throw new Error("Command args must be an array of strings");
	}
	return args as string[];
}

function sanitizeEnv(env: unknown): Record<string, string> | undefined {
	if (env === undefined) return undefined;
	if (env === null || typeof env !== "object" || Array.isArray(env)) {
		throw new Error("Command env must be a string map");
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
		if (typeof value !== "string") throw new Error(`Command env value for ${key} must be a string`);
		out[key] = value;
	}
	return out;
}

/**
 * Run a plugin-declared command through the shared cross-platform launcher.
 * Authoritative gate (defense in depth behind the renderer's own check):
 * the plugin must hold `agent.command.run`, have declared `file`, and have it
 * currently enabled. Returns buffered stdout/stderr + exit code; a non-zero
 * exit resolves normally (the caller inspects exitCode) — only spawn failures
 * (e.g. executable missing) reject.
 */
export async function runPluginCommand(
	pluginId: string,
	file: string,
	args: unknown,
	options: PluginCommandRunOptions | undefined,
): Promise<PluginCommandRunResult> {
	if (typeof pluginId !== "string" || pluginId.trim().length === 0) {
		throw new Error("Invalid plugin id");
	}
	if (typeof file !== "string" || file.trim().length === 0) {
		throw new Error("Invalid command file");
	}
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (!plugin.enabled) throw new Error(`Plugin disabled: ${pluginId}`);
	if (plugin.trustLevel !== "official") {
		throw new Error(`Plugin command execution is restricted to official plugins: ${pluginId}`);
	}
	if (!hasGrantedPermission(plugin, "agent.command.run")) {
		throw new Error("Plugin permission denied: agent.command.run");
	}
	if (!plugin.declaredCommands.includes(file)) {
		throw new Error(`Command not declared: ${file}`);
	}
	if (!plugin.grantedCommandNames.includes(file)) {
		throw new Error(`Command disabled by user: ${file}`);
	}

	const normalizedArgs = sanitizeArgs(args);
	const env = sanitizeEnv(options?.env);
	const cwd = typeof options?.cwd === "string" && options.cwd.trim().length > 0 ? options.cwd : undefined;
	const timeout = clampTimeout(options?.timeoutMs);

	let child: ChildProcess;
	try {
		child = spawnCrossPlatformCommand(file, normalizedArgs, {
			cwd,
			env: createPluginCommandEnvironment(env),
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		commandLog.warn("plugin command spawn failed", { pluginId, file, code });
		throw new Error(`Command failed to start: ${file} (${code ?? String(error)})`);
	}

	return new Promise<PluginCommandRunResult>((resolvePromise, rejectPromise) => {
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let outputLimitExceeded = false;
		let settled = false;

		const finish = (result: PluginCommandRunResult | Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			if (result instanceof Error) rejectPromise(result);
			else resolvePromise(result);
		};
		const append = (chunks: Buffer[], chunk: Buffer, stream: "stdout" | "stderr"): void => {
			chunks.push(chunk);
			if (stream === "stdout") stdoutBytes += chunk.length;
			else stderrBytes += chunk.length;
			if (stdoutBytes > MAX_BUFFER_BYTES || stderrBytes > MAX_BUFFER_BYTES) {
				outputLimitExceeded = true;
				child.kill();
			}
		};
		const timeoutHandle = setTimeout(() => child.kill(), timeout);
		timeoutHandle.unref();

		child.stdout?.on("data", (chunk: Buffer) => append(stdout, chunk, "stdout"));
		child.stderr?.on("data", (chunk: Buffer) => append(stderr, chunk, "stderr"));
		child.once("error", (error: NodeJS.ErrnoException) => {
			commandLog.warn("plugin command spawn failed", { pluginId, file, code: error.code });
			finish(new Error(`Command failed to start: ${file} (${error.code ?? error.message})`));
		});
		child.once("close", (exitCode) => {
			if (outputLimitExceeded) {
				finish(new Error(`Command output exceeded ${MAX_BUFFER_BYTES} bytes: ${file}`));
				return;
			}
			finish({
				stdout: Buffer.concat(stdout).toString(),
				stderr: Buffer.concat(stderr).toString(),
				exitCode,
			});
		});
	});
}
