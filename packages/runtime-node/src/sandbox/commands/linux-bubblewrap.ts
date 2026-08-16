import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve as resolvePath } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { SandboxShellGrant } from "@vetta/runtime-core/sandbox";
import type { ForegroundCommandOperations } from "@vetta/runtime-tools";
import { getSandboxShellGrant } from "../sandbox-permissions.js";
import type { NodeSandboxEnvironment, NodeSandboxShell } from "./contracts.js";

const LINUX_ENV_WHITELIST = [
	"PATH",
	"LANG",
	"LC_ALL",
	"TERM",
	"npm_config_registry",
	"npm_config_prefix",
	"npm_config_cache",
	"npm_config_userconfig",
	"NPM_CONFIG_REGISTRY",
	"NPM_CONFIG_PREFIX",
	"NPM_CONFIG_CACHE",
	"NPM_CONFIG_USERCONFIG",
	"PIP_INDEX_URL",
	"PIP_TRUSTED_HOST",
	"PIP_CONFIG_FILE",
	"PIP_CACHE_DIR",
	"VETTA_HOME",
	"VETTA_ACTION_RPC_ENDPOINT_FILE",
	"VETTA_DESKTOP_EXE",
	"VETTA_CLI_APP_PATH",
] as const;
const SANDBOX_HOME = "/tmp/vetta-home";
const SANDBOX_BIN_DIR = "/vetta-bin";
const STANDARD_READ_ONLY_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"] as const;

export interface LinuxBubblewrapCommandOptions {
	readonly bubblewrapPath?: string;
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

export function resolveLinuxBubblewrapPath(explicitPath?: string): string {
	const explicitCandidates = [explicitPath, process.env.VETTA_LINUX_BWRAP_PATH].filter(
		(value): value is string => typeof value === "string" && value.trim().length > 0,
	);
	for (const candidate of explicitCandidates) {
		if (isAbsolute(candidate) && existsSync(candidate)) return candidate;
		const resolved = findOnPathUnix(candidate);
		if (resolved) return resolved;
	}
	const pathCandidates = ["bwrap", "bubblewrap"];
	for (const candidate of pathCandidates) {
		const resolved = findOnPathUnix(candidate);
		if (resolved) return resolved;
	}
	const searched = [...explicitCandidates, ...pathCandidates].map((item) => `  - ${item}`).join("\n");
	throw new Error(
		"Linux sandbox requires bubblewrap. Install `bwrap`/`bubblewrap` or set VETTA_LINUX_BWRAP_PATH." +
			`\nSearched:\n${searched}`,
	);
}

function resolveLinuxShellCommand(resolveShell: () => NodeSandboxShell): NodeSandboxShell {
	const shell = resolveShell();
	const executable = isAbsolute(shell.executable) ? shell.executable : findOnPathUnix(shell.executable);
	if (!executable) throw new Error(`Linux sandbox shell not found on PATH: ${shell.executable}`);
	return { executable, args: shell.args };
}

function ensureShellIsWithinMountedRoots(shellPath: string): void {
	const normalizedShellPath = resolvePath(shellPath);
	const allowed = STANDARD_READ_ONLY_ROOTS.some((root) => {
		const normalizedRoot = resolvePath(root);
		return normalizedShellPath === normalizedRoot || normalizedShellPath.startsWith(`${normalizedRoot}/`);
	});
	if (!allowed) {
		throw new Error(
			`Linux sandbox cannot run shell outside standard system roots: ${normalizedShellPath}` +
				"\nConfigure shellPath to a binary under /usr, /bin, /sbin, /lib, /lib64, or /etc.",
		);
	}
}

function appendParentDirs(args: string[], targetPath: string, createdDirs: Set<string>): void {
	const segments = resolvePath(targetPath).split("/").filter(Boolean);
	let current = "";
	for (let index = 0; index < segments.length - 1; index++) {
		current += `/${segments[index]}`;
		if (createdDirs.has(current)) continue;
		args.push("--dir", current);
		createdDirs.add(current);
	}
}

function isUnderStandardReadOnlyRoot(path: string): boolean {
	const normalizedPath = resolvePath(path);
	return STANDARD_READ_ONLY_ROOTS.some((root) => {
		const normalizedRoot = resolvePath(root);
		return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
	});
}

function existingDir(path: string | undefined): string | undefined {
	if (!path?.trim()) return undefined;
	const normalized = resolvePath(path);
	return existsSync(normalized) && !isUnderStandardReadOnlyRoot(normalized) ? normalized : undefined;
}

function existingFile(path: string | undefined): string | undefined {
	if (!path?.trim()) return undefined;
	const normalized = resolvePath(path);
	return existsSync(normalized) && !isUnderStandardReadOnlyRoot(normalized) ? normalized : undefined;
}

function collectPathDirs(env: NodeSandboxEnvironment | undefined): string[] {
	const pathValue = env?.PATH ?? process.env.PATH;
	if (!pathValue) return [];
	return pathValue
		.split(delimiter)
		.map(existingDir)
		.filter((path): path is string => path !== undefined);
}

function collectEnvReadOnlyMounts(env: NodeSandboxEnvironment | undefined): {
	readonly dirs: string[];
	readonly files: string[];
} {
	const dirs = [
		existingDir(env?.npm_config_prefix ?? process.env.npm_config_prefix),
		existingDir(env?.NPM_CONFIG_PREFIX ?? process.env.NPM_CONFIG_PREFIX),
		existingDir(env?.npm_config_cache ?? process.env.npm_config_cache),
		existingDir(env?.NPM_CONFIG_CACHE ?? process.env.NPM_CONFIG_CACHE),
		existingDir(env?.PIP_CACHE_DIR ?? process.env.PIP_CACHE_DIR),
	].filter((path): path is string => path !== undefined);
	const vettaHome = env?.VETTA_HOME ?? process.env.VETTA_HOME;
	const endpointFile =
		env?.VETTA_ACTION_RPC_ENDPOINT_FILE ??
		process.env.VETTA_ACTION_RPC_ENDPOINT_FILE ??
		(vettaHome ? join(vettaHome, "action-server.json") : undefined);
	const files = [
		env?.npm_config_userconfig ?? process.env.npm_config_userconfig,
		env?.NPM_CONFIG_USERCONFIG ?? process.env.NPM_CONFIG_USERCONFIG,
		env?.PIP_CONFIG_FILE ?? process.env.PIP_CONFIG_FILE,
		endpointFile,
	]
		.map(existingFile)
		.filter((path): path is string => path !== undefined);
	return { dirs, files };
}

function readConfiguredVettaPaths(env: NodeSandboxEnvironment | undefined): {
	readonly vettaAppPath?: string;
	readonly vettaCliAppPath?: string;
} {
	const configPath = join(env?.VETTA_HOME ?? getVettaHomePath(), "desktop-config.json");
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
			vettaAppPath?: unknown;
			vettaCliAppPath?: unknown;
		};
		return {
			vettaAppPath: typeof parsed.vettaAppPath === "string" ? parsed.vettaAppPath : undefined,
			vettaCliAppPath: typeof parsed.vettaCliAppPath === "string" ? parsed.vettaCliAppPath : undefined,
		};
	} catch {
		return {};
	}
}

function resolveVettaDesktopExe(env: NodeSandboxEnvironment | undefined): string | undefined {
	return existingFile(
		env?.VETTA_DESKTOP_EXE ?? process.env.VETTA_DESKTOP_EXE ?? readConfiguredVettaPaths(env).vettaAppPath,
	);
}

function resolveVettaCliAppPath(env: NodeSandboxEnvironment | undefined): string | undefined {
	return existingFile(
		env?.VETTA_CLI_APP_PATH ?? process.env.VETTA_CLI_APP_PATH ?? readConfiguredVettaPaths(env).vettaCliAppPath,
	);
}

function createVettaCliShim(
	env: NodeSandboxEnvironment | undefined,
): { readonly hostDir: string; readonly hostPath: string } | undefined {
	const vettaCliAppPath = resolveVettaCliAppPath(env);
	if (!vettaCliAppPath) return undefined;
	const hostDir = mkdtempSync(join(tmpdir(), "vetta-linux-sandbox-bin-"));
	const hostPath = join(hostDir, "vetta");
	writeFileSync(hostPath, ["#!/usr/bin/env sh", `exec "${vettaCliAppPath}" "$@"`, ""].join("\n"), "utf8");
	chmodSync(hostPath, 0o755);
	return { hostDir, hostPath };
}

export function buildLinuxSandboxArgs(
	command: string,
	cwd: string,
	shell: NodeSandboxShell,
	env: NodeSandboxEnvironment | undefined,
	grant: SandboxShellGrant | undefined,
	vettaCliShimPath: string | undefined,
): string[] {
	const args: string[] = ["--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc", "--unshare-uts"];
	const createdDirs = new Set<string>();
	const mountedRoots = new Set<string>();
	appendParentDirs(args, cwd, createdDirs);
	for (const root of STANDARD_READ_ONLY_ROOTS) {
		if (!existsSync(root) || mountedRoots.has(root)) continue;
		args.push("--ro-bind", root, root);
		mountedRoots.add(root);
	}
	const readOnlyMounts = collectEnvReadOnlyMounts(env);
	const vettaDesktopExe = resolveVettaDesktopExe(env);
	const vettaCliAppPath = resolveVettaCliAppPath(env);
	const vettaDesktopExeDir = vettaDesktopExe ? resolvePath(vettaDesktopExe, "..") : undefined;
	const vettaCliAppDir = vettaCliAppPath ? resolvePath(vettaCliAppPath, "..") : undefined;
	for (const root of Array.from(new Set([...collectPathDirs(env), ...readOnlyMounts.dirs]))) {
		if (mountedRoots.has(root)) continue;
		appendParentDirs(args, root, createdDirs);
		args.push("--ro-bind", root, root);
		mountedRoots.add(root);
	}
	for (const file of Array.from(new Set(readOnlyMounts.files))) {
		if (mountedRoots.has(file)) continue;
		appendParentDirs(args, file, createdDirs);
		args.push("--ro-bind", file, file);
		mountedRoots.add(file);
	}
	args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
	appendParentDirs(args, cwd, new Set());
	args.push("--bind", cwd, cwd);
	for (const root of [vettaDesktopExeDir, vettaCliAppDir]) {
		if (!root || mountedRoots.has(root)) continue;
		appendParentDirs(args, root, createdDirs);
		args.push("--ro-bind", root, root);
		mountedRoots.add(root);
	}
	if (vettaCliShimPath) args.push("--dir", SANDBOX_BIN_DIR, "--ro-bind", vettaCliShimPath, `${SANDBOX_BIN_DIR}/vetta`);
	for (const root of grant?.allowWriteRoots ?? []) {
		const normalizedRoot = resolvePath(root);
		if (!existsSync(normalizedRoot) || mountedRoots.has(normalizedRoot)) continue;
		appendParentDirs(args, normalizedRoot, createdDirs);
		args.push("--bind", normalizedRoot, normalizedRoot);
		mountedRoots.add(normalizedRoot);
	}
	args.push("--dir", SANDBOX_HOME);

	const baseEnv = env ?? process.env;
	const pathValue = vettaCliShimPath
		? [SANDBOX_BIN_DIR, baseEnv.PATH].filter((value): value is string => Boolean(value)).join(delimiter)
		: baseEnv.PATH;
	args.push("--clearenv");
	for (const key of LINUX_ENV_WHITELIST) {
		const value =
			key === "PATH"
				? pathValue
				: key === "VETTA_DESKTOP_EXE"
					? vettaDesktopExe
					: key === "VETTA_CLI_APP_PATH"
						? vettaCliAppPath
						: baseEnv[key];
		if (typeof value === "string" && value.length > 0) args.push("--setenv", key, value);
	}
	args.push("--setenv", "HOME", SANDBOX_HOME, "--setenv", "TMPDIR", "/tmp", "--setenv", "PWD", cwd);
	args.push("--chdir", cwd, "--", shell.executable, ...shell.args, command);
	return args;
}

export function createLinuxBubblewrapCommandOperations(
	options: LinuxBubblewrapCommandOptions,
): ForegroundCommandOperations {
	const bubblewrapPath = resolveLinuxBubblewrapPath(options.bubblewrapPath);
	const shell = resolveLinuxShellCommand(options.resolveShell);
	ensureShellIsWithinMountedRoots(shell.executable);
	return {
		exec: (command, cwd, { onData, signal, timeout, env }) =>
			new Promise<{ exitCode: number | null }>((resolve, reject) => {
				if (!existsSync(cwd)) return reject(new Error(`Working directory does not exist: ${cwd}`));
				const vettaCliShim = createVettaCliShim(env);
				const args = buildLinuxSandboxArgs(
					command,
					cwd,
					shell,
					env,
					getSandboxShellGrant(cwd),
					vettaCliShim?.hostPath,
				);
				const child = spawn(bubblewrapPath, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
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
				const cleanup = () => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					signal?.removeEventListener("abort", onAbort);
					if (vettaCliShim) rmSync(vettaCliShim.hostDir, { recursive: true, force: true });
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
			}),
	};
}
