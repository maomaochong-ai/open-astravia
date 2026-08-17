import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { getVettaConfigDirName } from "@vetta/action-rpc";
import type { SandboxShellGrant } from "@vetta/runtime-core/sandbox";
import type { ForegroundCommandOperations } from "@vetta/runtime-tools";
import { getSandboxShellGrant } from "../sandbox-permissions.js";
import type { NodeSandboxEnvironment, NodeSandboxShell } from "./contracts.js";

const MACOS_ENV_WHITELIST = ["PATH", "LANG", "LC_ALL", "TERM", "VETTA_CLI_APP_PATH"] as const;

export interface MacosSeatbeltCommandOptions {
	readonly sandboxExecPath?: string;
	readonly resolveShell: () => NodeSandboxShell;
}

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

export function resolveMacosSandboxExecPath(explicitPath?: string): string {
	const candidate = explicitPath?.trim() || process.env.VETTA_MACOS_SANDBOX_EXEC_PATH?.trim();
	if (candidate) {
		if (isAbsolute(candidate) && existsSync(candidate)) return candidate;
		const resolved = findOnPathUnix(candidate);
		if (resolved) return resolved;
		throw new Error(`Configured macOS sandbox-exec binary does not exist: ${candidate}`);
	}
	if (existsSync("/usr/bin/sandbox-exec")) return "/usr/bin/sandbox-exec";
	const resolved = findOnPathUnix("sandbox-exec");
	if (resolved) return resolved;
	throw new Error(
		"macOS sandbox requires sandbox-exec. Could not locate /usr/bin/sandbox-exec or sandbox-exec on PATH.",
	);
}

function resolveMacosShellCommand(resolveShell: () => NodeSandboxShell): NodeSandboxShell {
	const shell = resolveShell();
	const executable = isAbsolute(shell.executable) ? shell.executable : findOnPathUnix(shell.executable);
	if (!executable) throw new Error(`macOS sandbox shell not found on PATH: ${shell.executable}`);
	return { executable, args: shell.args };
}

function normalizeExistingPath(path: string): string {
	return realpathSync(path);
}

function buildPathFilters(kind: "subpath" | "literal", paths: readonly string[]): string {
	return paths.map((path) => `(${kind} ${JSON.stringify(path)})`).join(" ");
}

export function buildMacosSandboxProfile(cwd: string, tempRoot: string, grant: SandboxShellGrant | undefined): string {
	const homeDir = normalizeExistingPath(homedir());
	const realCwd = normalizeExistingPath(cwd);
	const sandboxHome = normalizeExistingPath(join(tempRoot, "home"));
	const sandboxTmp = normalizeExistingPath(join(tempRoot, "tmp"));
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
	const grantWriteRoots = (grant?.allowWriteRoots ?? []).filter((path) => existsSync(path)).map(normalizeExistingPath);
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

function resolveVettaCliAppPath(env: NodeSandboxEnvironment | undefined): string | undefined {
	const value = env?.VETTA_CLI_APP_PATH ?? process.env.VETTA_CLI_APP_PATH;
	return typeof value === "string" && value.length > 0 && existsSync(value) ? value : undefined;
}

async function createVettaCliShim(
	tempRoot: string,
	env: NodeSandboxEnvironment | undefined,
): Promise<string | undefined> {
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
	env: NodeSandboxEnvironment | undefined,
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
		if (typeof value === "string" && value.length > 0) nextEnv[key] = value;
	}
	nextEnv.HOME = join(tempRoot, "home");
	nextEnv.TMPDIR = join(tempRoot, "tmp");
	nextEnv.PWD = cwd;
	return nextEnv;
}

export function createMacosSeatbeltCommandOperations(
	options: MacosSeatbeltCommandOptions,
): ForegroundCommandOperations {
	const sandboxExecPath = options.sandboxExecPath ?? resolveMacosSandboxExecPath();
	const shell = resolveMacosShellCommand(options.resolveShell);
	return {
		exec: (command, cwd, { onData, signal, timeout, env }) =>
			new Promise<{ exitCode: number | null }>((resolve, reject) => {
				void (async () => {
					if (!existsSync(cwd)) return reject(new Error(`Working directory does not exist: ${cwd}`));
					const tempRoot = await mkdtemp(join(tmpdir(), "vetta-macos-sandbox-"));
					await mkdir(join(tempRoot, "home"), { recursive: true });
					await mkdir(join(tempRoot, "tmp"), { recursive: true });
					const vettaShimDir = await createVettaCliShim(tempRoot, env);
					const profilePath = join(tempRoot, "profile.sb");
					await writeFile(profilePath, buildMacosSandboxProfile(cwd, tempRoot, getSandboxShellGrant(cwd)), "utf8");
					const child = spawn(sandboxExecPath, ["-f", profilePath, shell.executable, ...shell.args, command], {
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
							if (child.pid) killProcessGroup(child.pid);
						}, timeout * 1000);
					}
					child.stdout?.on("data", onData);
					child.stderr?.on("data", onData);
					const onAbort = () => {
						if (child.pid) killProcessGroup(child.pid);
					};
					if (signal?.aborted) onAbort();
					else signal?.addEventListener("abort", onAbort, { once: true });
					const cleanup = (): void => {
						if (timeoutHandle) clearTimeout(timeoutHandle);
						signal?.removeEventListener("abort", onAbort);
						void rm(tempRoot, { recursive: true, force: true });
					};
					child.on("error", (error) => {
						cleanup();
						reject(error);
					});
					child.on("close", (code) => {
						cleanup();
						if (signal?.aborted) return reject(new Error("aborted"));
						if (timedOut) return reject(new Error(`timeout:${timeout}`));
						resolve({ exitCode: code });
					});
				})().catch(reject);
			}),
	};
}
