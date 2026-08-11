import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { getVettaConfigDirName } from "@vetta/action-rpc";
import { getSandboxShellGrant, type SandboxShellGrant } from "@vetta/runtime-core/sandbox";
import type { CodingToolRegistration, ForegroundCommandOperations } from "@vetta/runtime-tools/coding";
import { getShellConfig } from "../../../host/command-execution/shell-runtime.js";
import { createSandboxToolRegistrations, type SandboxRuntimeToolOptions } from "./sandbox-tool-utils.js";

const MACOS_ENV_WHITELIST = ["PATH", "LANG", "LC_ALL", "TERM", "VETTA_CLI_APP_PATH"] as const;
const MACOS_SANDBOX_BACKEND = "macos-seatbelt";

function killProcessGroup(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Process already exited.
		}
	}
}

function findOnPathUnix(binary: string): string | undefined {
	try {
		const result = spawnSync("which", [binary], { encoding: "utf-8", timeout: 5000 });
		if (result.status !== 0 || !result.stdout) return undefined;
		const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
		return firstMatch && existsSync(firstMatch) ? firstMatch : undefined;
	} catch {
		return undefined;
	}
}

function resolveMacosSandboxExecPath(): string {
	const explicitPath = process.env.VETTA_MACOS_SANDBOX_EXEC_PATH?.trim();
	if (explicitPath) {
		if (isAbsolute(explicitPath) && existsSync(explicitPath)) return explicitPath;
		const resolved = findOnPathUnix(explicitPath);
		if (resolved) return resolved;
		throw new Error(`Configured macOS sandbox-exec binary does not exist: ${explicitPath}`);
	}

	if (existsSync("/usr/bin/sandbox-exec")) return "/usr/bin/sandbox-exec";
	const resolved = findOnPathUnix("sandbox-exec");
	if (resolved) return resolved;
	throw new Error(
		"macOS sandbox requires sandbox-exec. Could not locate /usr/bin/sandbox-exec or sandbox-exec on PATH.",
	);
}

function resolveMacosShellCommand(): { command: string; args: string[] } {
	const shellConfig = getShellConfig();
	const resolvedCommand = isAbsolute(shellConfig.shell) ? shellConfig.shell : findOnPathUnix(shellConfig.shell);
	if (!resolvedCommand) {
		throw new Error(`macOS sandbox shell not found on PATH: ${shellConfig.shell}`);
	}
	return {
		command: resolvedCommand,
		args: shellConfig.args,
	};
}

function normalizeExistingPath(path: string): string {
	return realpathSync(path);
}

function sbplString(value: string): string {
	return JSON.stringify(value);
}

function buildPathFilters(kind: "subpath" | "literal", paths: string[]): string {
	return paths.map((path) => `(${kind} ${sbplString(path)})`).join(" ");
}

function buildMacosSandboxProfile(cwd: string, tempRoot: string, grant: SandboxShellGrant | undefined): string {
	const homeDir = normalizeExistingPath(homedir());
	const realCwd = normalizeExistingPath(cwd);
	const sandboxHome = normalizeExistingPath(join(tempRoot, "home"));
	const sandboxTmp = normalizeExistingPath(join(tempRoot, "tmp"));
	// Only the redirected HOME and TMPDIR subdirs inside tempRoot are writable.
	// tempRoot itself (which holds profile.sb) must remain read-only to the
	// sandboxed shell so it can't tamper with the policy file.
	const tempDirs = Array.from(new Set([normalizeExistingPath(tmpdir()), "/tmp", "/private/tmp"]));
	const sensitiveDenyPaths = [
		join(homeDir, ".ssh"),
		join(homeDir, ".aws"),
		join(homeDir, ".gnupg"),
		join(homeDir, ".kube"),
		join(homeDir, ".docker"),
		join(homeDir, ".config", "gcloud"),
		join(homeDir, "Library", "Keychains"),
		join(homeDir, getVettaConfigDirName()),
		join(homeDir, ".pi"),
	].filter((path) => path !== realCwd && !realCwd.startsWith(`${path}/`));
	const grantWriteRoots = (grant?.allowWriteRoots ?? [])
		.filter((path) => existsSync(path))
		.map((path) => normalizeExistingPath(path));
	const writablePaths = Array.from(new Set([realCwd, sandboxHome, sandboxTmp, ...tempDirs, ...grantWriteRoots]));
	const writableDeviceLiterals = ["/dev/null", "/dev/zero", "/dev/tty", "/dev/stdout", "/dev/stderr"];
	const writableDeviceSubpaths = ["/dev/fd"];
	return [
		"(version 1)",
		"(deny default)",
		"(allow process*)",
		"(allow sysctl-read)",
		"(allow file-read*)",
		`(deny file-read* ${buildPathFilters("subpath", sensitiveDenyPaths)})`,
		`(allow file-write* ${buildPathFilters("subpath", writablePaths)} ${buildPathFilters("subpath", writableDeviceSubpaths)} ${buildPathFilters("literal", writableDeviceLiterals)})`,
		`(deny file-write* ${buildPathFilters("subpath", sensitiveDenyPaths)})`,
	].join("\n");
}

function resolveVettaCliAppPath(env: NodeJS.ProcessEnv | undefined): string | undefined {
	const value = env?.VETTA_CLI_APP_PATH ?? process.env.VETTA_CLI_APP_PATH;
	return typeof value === "string" && value.length > 0 && existsSync(value) ? value : undefined;
}

async function createVettaCliShim(tempRoot: string, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
	const vettaCliAppPath = resolveVettaCliAppPath(env);
	if (!vettaCliAppPath) return undefined;
	const shimDir = join(tempRoot, "bin");
	await mkdir(shimDir, { recursive: true });
	await writeFile(join(shimDir, "vetta"), ["#!/usr/bin/env sh", `exec "${vettaCliAppPath}" "$@"`, ""].join("\n"), {
		encoding: "utf8",
		mode: 0o755,
	});
	return shimDir;
}

function buildSandboxEnv(
	cwd: string,
	tempRoot: string,
	env: NodeJS.ProcessEnv | undefined,
	vettaShimDir: string | undefined,
): NodeJS.ProcessEnv {
	const baseEnv = env ?? process.env;
	const nextEnv: NodeJS.ProcessEnv = {};
	for (const key of MACOS_ENV_WHITELIST) {
		const value =
			key === "PATH" && vettaShimDir
				? [vettaShimDir, baseEnv.PATH].filter((item): item is string => Boolean(item)).join(delimiter)
				: key === "VETTA_CLI_APP_PATH"
					? resolveVettaCliAppPath(env)
					: baseEnv[key];
		if (typeof value === "string" && value.length > 0) {
			nextEnv[key] = value;
		}
	}
	nextEnv.HOME = join(tempRoot, "home");
	nextEnv.TMPDIR = join(tempRoot, "tmp");
	nextEnv.PWD = cwd;
	return nextEnv;
}

function createMacosSeatbeltShellOperations(sandboxExecPath: string): ForegroundCommandOperations {
	const shellCommand = resolveMacosShellCommand();

	return {
		exec: (command, cwd, { onData, signal, timeout, env }) => {
			return new Promise<{ exitCode: number | null }>((resolve, reject) => {
				void (async () => {
					if (!existsSync(cwd)) {
						reject(new Error(`Working directory does not exist: ${cwd}`));
						return;
					}

					const tempRoot = await mkdtemp(join(tmpdir(), "vetta-macos-sandbox-"));
					await mkdir(join(tempRoot, "home"), { recursive: true });
					await mkdir(join(tempRoot, "tmp"), { recursive: true });
					const vettaShimDir = await createVettaCliShim(tempRoot, env);
					const profilePath = join(tempRoot, "profile.sb");
					const grant = getSandboxShellGrant(cwd);
					await writeFile(profilePath, buildMacosSandboxProfile(cwd, tempRoot, grant), "utf8");

					const args = ["-f", profilePath, shellCommand.command, ...shellCommand.args, command];
					const child = spawn(sandboxExecPath, args, {
						cwd,
						detached: true,
						env: buildSandboxEnv(cwd, tempRoot, env, vettaShimDir),
						stdio: ["ignore", "pipe", "pipe"],
					});

					let timedOut = false;
					let timeoutHandle: NodeJS.Timeout | undefined;

					if (typeof timeout === "number" && timeout > 0) {
						timeoutHandle = setTimeout(() => {
							timedOut = true;
							if (child.pid) {
								killProcessGroup(child.pid);
							}
						}, timeout * 1000);
					}

					if (child.stdout) child.stdout.on("data", onData);
					if (child.stderr) child.stderr.on("data", onData);

					const cleanup = (): void => {
						void rm(tempRoot, { recursive: true, force: true });
					};
					const onAbort = () => {
						if (child.pid) {
							killProcessGroup(child.pid);
						}
					};
					if (signal) {
						if (signal.aborted) {
							onAbort();
						} else {
							signal.addEventListener("abort", onAbort, { once: true });
						}
					}

					child.on("error", (err) => {
						if (timeoutHandle) clearTimeout(timeoutHandle);
						if (signal) signal.removeEventListener("abort", onAbort);
						cleanup();
						reject(err);
					});

					child.on("close", (code) => {
						if (timeoutHandle) clearTimeout(timeoutHandle);
						if (signal) signal.removeEventListener("abort", onAbort);
						cleanup();
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
				})().catch((error: unknown) => {
					reject(error);
				});
			});
		},
	};
}

export interface MacosSeatbeltToolOptions extends SandboxRuntimeToolOptions {
	readonly sandboxExecPath?: string;
	readonly commandOperations?: ForegroundCommandOperations;
}

export function buildMacosSeatbeltToolRegistrations(
	options: MacosSeatbeltToolOptions,
): readonly CodingToolRegistration[] {
	const commandOperations =
		options.commandOperations ??
		createMacosSeatbeltShellOperations(options.sandboxExecPath ?? resolveMacosSandboxExecPath());
	return createSandboxToolRegistrations({ ...options, platform: "darwin", commandOperations });
}

export function resolveAvailableMacosSandboxExecPath(): string | undefined {
	try {
		return resolveMacosSandboxExecPath();
	} catch {
		return undefined;
	}
}

export const macosSeatbeltBackend = MACOS_SANDBOX_BACKEND;
