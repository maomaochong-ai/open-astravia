import { execFile, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { SessionExecutionMode } from "@vetta/runtime-core";
import { type LinuxSandboxBackend, resolveLinuxBubblewrapBinary } from "./binary-resolver.js";
import { resolveWindowsSandboxHostBinary } from "./windows-binary-resolver.js";

export type SandboxStatus = "unknown" | "available" | "unavailable";
export type SandboxBackend = LinuxSandboxBackend | "macos-seatbelt" | "windows-host" | null;

export interface SandboxCapabilityFeatures {
	readRoots: boolean;
	writeRoots: boolean;
	denyRead: boolean;
	denyWrite: boolean;
	tempRootIsolation: boolean;
	networkIsolation: boolean;
	processTreeKill: boolean;
	passiveProbe: boolean;
	activeProbe: boolean;
}

export interface SandboxCapability {
	status: SandboxStatus;
	backend: SandboxBackend;
	platform: NodeJS.Platform;
	binaryPath?: string;
	reason?: string;
	details?: string;
	checkedAt?: number;
	features?: SandboxCapabilityFeatures;
}

export type LinuxSandboxStatus = SandboxStatus;
export interface LinuxSandboxCapability extends SandboxCapability {
	backend: LinuxSandboxBackend | null;
}

const STANDARD_READ_ONLY_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"] as const;
const PROBE_HOME = "/tmp/vetta-probe-home";
const WINDOWS_PROBE_TIMEOUT_MS = 10000;

interface WindowsHostCapabilitiesJson {
	version: number;
	backend: string;
	fullSandbox: boolean;
	explicitRoots: boolean;
	denyRead: boolean;
	denyWrite: boolean;
	tempRoot: boolean;
	networkIsolation: boolean;
	jobObjectKillTree: boolean;
	clearEnv: boolean;
	limitedReasons: string[];
}

interface WindowsProbeResult {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: NodeJS.ErrnoException;
}

let sandboxCapability: SandboxCapability = {
	status: "unknown",
	backend: null,
	platform: process.platform,
};
let sandboxInitializationPromise: Promise<SandboxCapability> | undefined;

function buildLinuxProbeArgs(commandPath: string): string[] {
	const args: string[] = ["--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc", "--unshare-uts"];

	for (const root of STANDARD_READ_ONLY_ROOTS) {
		if (!existsSync(root)) continue;
		args.push("--ro-bind", root, root);
	}

	args.push("--proc", "/proc", "--dev", "/dev");
	args.push("--tmpfs", "/tmp", "--dir", PROBE_HOME);
	args.push("--clearenv", "--setenv", "HOME", PROBE_HOME);
	args.push("--", commandPath);
	return args;
}

function resolveLinuxProbeCommandPath(): string | undefined {
	for (const candidate of ["/usr/bin/true", "/bin/true"]) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function classifyLinuxProbeFailure(stderr: string, errorCode?: string): { reason: string; details: string } {
	const lowered = stderr.toLowerCase();
	if (errorCode === "EACCES") {
		return {
			reason: "binary_not_executable",
			details: stderr || "The Linux sandbox binary exists but is not executable.",
		};
	}
	if (
		lowered.includes("no permissions to create new namespace") ||
		lowered.includes("creating new namespace failed") ||
		lowered.includes("user namespace") ||
		lowered.includes("operation not permitted")
	) {
		return {
			reason: "userns_unavailable",
			details: stderr || "The host Linux environment does not allow the required namespace operations.",
		};
	}
	return {
		reason: "probe_command_failed",
		details: stderr || "The Linux sandbox probe command failed.",
	};
}

function findOnPathUnix(binary: string): string | undefined {
	const pathValue = process.env.PATH;
	if (!pathValue) return undefined;

	for (const entry of pathValue.split(":")) {
		if (!entry) continue;
		const candidate = resolvePath(entry, binary);
		if (!existsSync(candidate)) continue;
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Ignore non-executable matches.
		}
	}

	return undefined;
}

function resolveMacosSandboxExecPath(): string | undefined {
	const explicitPath = process.env.VETTA_MACOS_SANDBOX_EXEC_PATH?.trim();
	if (explicitPath) {
		if (isAbsolute(explicitPath)) {
			if (!existsSync(explicitPath)) {
				throw new Error(`Configured macOS sandbox-exec binary does not exist: ${explicitPath}`);
			}
			accessSync(explicitPath, constants.X_OK);
			return explicitPath;
		}
		const resolved = findOnPathUnix(explicitPath);
		if (resolved) return resolved;
		throw new Error(`Configured macOS sandbox-exec binary does not exist on PATH: ${explicitPath}`);
	}
	if (existsSync("/usr/bin/sandbox-exec")) return "/usr/bin/sandbox-exec";
	return findOnPathUnix("sandbox-exec");
}

function buildMacosProbeProfile(): string {
	return ["(version 1)", "(deny default)", "(allow process*)", "(allow file-read*)"].join("\n");
}

function isWindowsHostCapabilitiesJson(value: unknown): value is WindowsHostCapabilitiesJson {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.version === "number" &&
		typeof candidate.backend === "string" &&
		typeof candidate.fullSandbox === "boolean" &&
		typeof candidate.explicitRoots === "boolean" &&
		typeof candidate.denyRead === "boolean" &&
		typeof candidate.denyWrite === "boolean" &&
		typeof candidate.tempRoot === "boolean" &&
		typeof candidate.networkIsolation === "boolean" &&
		typeof candidate.jobObjectKillTree === "boolean" &&
		typeof candidate.clearEnv === "boolean" &&
		Array.isArray(candidate.limitedReasons) &&
		candidate.limitedReasons.every((item) => typeof item === "string")
	);
}

function windowsFeaturesFromCapabilities(
	capabilities: WindowsHostCapabilitiesJson,
	activeProbe: boolean,
): SandboxCapabilityFeatures {
	return {
		readRoots: capabilities.explicitRoots,
		writeRoots: capabilities.explicitRoots,
		denyRead: capabilities.denyRead,
		denyWrite: capabilities.denyWrite,
		tempRootIsolation: capabilities.tempRoot,
		networkIsolation: capabilities.networkIsolation,
		processTreeKill: capabilities.jobObjectKillTree,
		passiveProbe: true,
		activeProbe,
	};
}

function runWindowsHostCommand(
	hostPath: string,
	args: string[],
	options: { cwd?: string; timeout: number },
): Promise<WindowsProbeResult> {
	return new Promise((resolve) => {
		execFile(
			hostPath,
			args,
			{
				cwd: options.cwd,
				encoding: "utf-8",
				timeout: options.timeout,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				const errorCode = error?.code;
				const status = error ? (typeof errorCode === "number" ? errorCode : null) : 0;
				resolve({
					status,
					stdout,
					stderr,
					...(error && status === null ? { error: error as NodeJS.ErrnoException } : {}),
				});
			},
		);
	});
}

async function readWindowsHostCapabilities(
	hostPath: string,
): Promise<WindowsHostCapabilitiesJson | { error: string; details: string }> {
	const result = await runWindowsHostCommand(hostPath, ["--capabilities", "--json"], { timeout: 5000 });
	if (result.error) {
		return {
			error:
				(result.error as NodeJS.ErrnoException).code === "EACCES"
					? "binary_not_executable"
					: "probe_command_failed",
			details: result.error.message,
		};
	}
	if (result.status !== 0) {
		const stderr = result.stderr ?? "";
		return {
			error: stderr.toLowerCase().includes("unknown argument") ? "unsupported_host_option" : "probe_command_failed",
			details: stderr || "Windows sandbox host capability command failed.",
		};
	}
	try {
		const parsed = JSON.parse(result.stdout) as unknown;
		if (isWindowsHostCapabilitiesJson(parsed)) return parsed;
		return {
			error: "probe_command_failed",
			details: "Windows sandbox host returned invalid capability JSON.",
		};
	} catch (error) {
		return {
			error: "probe_command_failed",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

function resolveWindowsProbeCommandPath(): string {
	const comspec = process.env.COMSPEC;
	if (comspec && existsSync(comspec)) return comspec;
	const systemRoot = process.env.SystemRoot;
	if (systemRoot) {
		const candidate = join(systemRoot, "System32", "cmd.exe");
		if (existsSync(candidate)) return candidate;
	}
	return "cmd.exe";
}

function buildWindowsProbeEnvArgs(tempRoot: string): string[] {
	const args = ["--clear-env"];
	const pathValue = process.env.PATH;
	const systemRoot = process.env.SystemRoot;
	const comspec = process.env.COMSPEC;
	if (pathValue) args.push("--env", `PATH=${pathValue}`);
	if (systemRoot) args.push("--env", `SystemRoot=${systemRoot}`);
	if (comspec) args.push("--env", `COMSPEC=${comspec}`);
	args.push("--env", `TEMP=${tempRoot}`, "--env", `TMP=${tempRoot}`);
	return args;
}

function runWindowsProbeCommand(options: {
	hostPath: string;
	workspaceRoot: string;
	tempRoot: string;
	command: string;
	commandCwd?: string;
	denyReadPath?: string;
	denyWritePath?: string;
}): Promise<WindowsProbeResult> {
	const cmdPath = resolveWindowsProbeCommandPath();
	const commandCwd = options.commandCwd ?? options.workspaceRoot;
	const readRoots = [options.workspaceRoot, options.tempRoot];
	const systemRoot = process.env.SystemRoot;
	if (systemRoot) readRoots.push(join(systemRoot, "System32"));
	const args = [
		"--backend",
		"auto",
		"--policy",
		"workspace-write",
		"--policy-cwd",
		options.workspaceRoot,
		"--cwd",
		commandCwd,
		"--temp-root",
		options.tempRoot,
		"--network",
		"none",
		...buildWindowsProbeEnvArgs(options.tempRoot),
	];
	for (const root of readRoots) {
		args.push("--read-root", root);
	}
	args.push("--write-root", options.workspaceRoot);
	if (options.denyReadPath) args.push("--deny-read-path", options.denyReadPath);
	if (options.denyWritePath) args.push("--deny-write-path", options.denyWritePath);
	args.push("--", cmdPath, "/d", "/s", "/c", options.command);
	return runWindowsHostCommand(options.hostPath, args, {
		cwd: commandCwd,
		timeout: WINDOWS_PROBE_TIMEOUT_MS,
	});
}

async function probeWindowsSandbox(): Promise<SandboxCapability> {
	const resolved = resolveWindowsSandboxHostBinary();
	if (!resolved) {
		return {
			status: "unavailable",
			backend: null,
			platform: process.platform,
			reason: "binary_not_found",
			details: "No bundled or configured Windows sandbox host binary was found.",
			checkedAt: Date.now(),
		};
	}

	const capabilities = await readWindowsHostCapabilities(resolved.path);
	if ("error" in capabilities) {
		return {
			status: "unavailable",
			backend: "windows-host",
			platform: process.platform,
			binaryPath: resolved.path,
			reason: capabilities.error,
			details: capabilities.details,
			checkedAt: Date.now(),
		};
	}

	if (!capabilities.fullSandbox || !capabilities.explicitRoots || !capabilities.denyWrite || !capabilities.tempRoot) {
		return {
			status: "unavailable",
			backend: "windows-host",
			platform: process.platform,
			binaryPath: resolved.path,
			reason: "limited_host_capabilities",
			details: `Windows sandbox host reported limited capabilities: ${capabilities.limitedReasons.join(", ")}`,
			checkedAt: Date.now(),
			features: windowsFeaturesFromCapabilities(capabilities, false),
		};
	}

	const probeRoot = mkdtempSync(join(tmpdir(), "vetta-windows-sandbox-probe-"));
	const outsideRoot = mkdtempSync(join(homedir(), ".vetta-windows-sandbox-outside-"));
	try {
		const workspaceRoot = join(probeRoot, "workspace");
		const tempRoot = join(probeRoot, "temp");
		mkdirSync(workspaceRoot, { recursive: true });
		mkdirSync(tempRoot, { recursive: true });

		const workspaceFile = join(workspaceRoot, "ok.txt");
		const workspaceWrite = await runWindowsProbeCommand({
			hostPath: resolved.path,
			workspaceRoot,
			tempRoot,
			command: "echo ok > ok.txt",
		});
		if (workspaceWrite.status !== 0 || !existsSync(workspaceFile)) {
			return {
				status: "unavailable",
				backend: "windows-host",
				platform: process.platform,
				binaryPath: resolved.path,
				reason: "probe_command_failed",
				details: workspaceWrite.stderr || "Windows sandbox workspace write probe failed.",
				checkedAt: Date.now(),
				features: windowsFeaturesFromCapabilities(capabilities, false),
			};
		}

		const outsideFile = join(outsideRoot, "no.txt");
		const outsideWrite = await runWindowsProbeCommand({
			hostPath: resolved.path,
			workspaceRoot,
			tempRoot,
			command: `echo no > ${outsideFile}`,
		});
		if (outsideWrite.status === 0 || existsSync(outsideFile)) {
			return {
				status: "unavailable",
				backend: "windows-host",
				platform: process.platform,
				binaryPath: resolved.path,
				reason: "write_root_not_enforced",
				details: "Windows sandbox allowed writing outside explicit write roots.",
				checkedAt: Date.now(),
				features: windowsFeaturesFromCapabilities(capabilities, false),
			};
		}

		const tempFile = join(tempRoot, "temp.txt");
		const tempWrite = await runWindowsProbeCommand({
			hostPath: resolved.path,
			workspaceRoot,
			tempRoot,
			commandCwd: tempRoot,
			command: "echo temp > temp.txt",
		});
		if (tempWrite.status !== 0 || !existsSync(tempFile)) {
			return {
				status: "unavailable",
				backend: "windows-host",
				platform: process.platform,
				binaryPath: resolved.path,
				reason: "temp_root_not_isolated",
				details: tempWrite.stderr || "Windows sandbox temp-root write probe failed.",
				checkedAt: Date.now(),
				features: windowsFeaturesFromCapabilities(capabilities, false),
			};
		}

		const denyWriteFile = join(workspaceRoot, "deny.txt");
		const denyWrite = await runWindowsProbeCommand({
			hostPath: resolved.path,
			workspaceRoot,
			tempRoot,
			denyWritePath: denyWriteFile,
			command: "echo deny > deny.txt",
		});
		if (denyWrite.status === 0) {
			return {
				status: "unavailable",
				backend: "windows-host",
				platform: process.platform,
				binaryPath: resolved.path,
				reason: "deny_write_not_enforced",
				details: "Windows sandbox allowed writing to an explicit deny-write path.",
				checkedAt: Date.now(),
				features: windowsFeaturesFromCapabilities(capabilities, false),
			};
		}

		let denyRead = capabilities.denyRead;
		const secretFile = join(workspaceRoot, "secret.txt");
		writeFileSync(secretFile, "secret", "utf8");
		if (capabilities.denyRead) {
			const denyReadResult = await runWindowsProbeCommand({
				hostPath: resolved.path,
				workspaceRoot,
				tempRoot,
				denyReadPath: secretFile,
				command: "type secret.txt",
			});
			denyRead = denyReadResult.status !== 0;
		}

		return {
			status: "available",
			backend: "windows-host",
			platform: process.platform,
			binaryPath: resolved.path,
			checkedAt: Date.now(),
			features: {
				...windowsFeaturesFromCapabilities(capabilities, true),
				denyRead,
			},
		};
	} finally {
		rmSync(probeRoot, { recursive: true, force: true });
		rmSync(outsideRoot, { recursive: true, force: true });
	}
}

function probeLinuxSandbox(): SandboxCapability {
	const resolved = resolveLinuxBubblewrapBinary();
	if (!resolved) {
		return {
			status: "unavailable",
			backend: null,
			platform: process.platform,
			reason: "binary_not_found",
			details: "No bundled or system bubblewrap binary was found.",
			checkedAt: Date.now(),
		};
	}

	const probeCommandPath = resolveLinuxProbeCommandPath();
	if (!probeCommandPath) {
		return {
			status: "unavailable",
			backend: resolved.backend,
			platform: process.platform,
			binaryPath: resolved.path,
			reason: "probe_command_failed",
			details: "Could not locate /usr/bin/true or /bin/true for sandbox probing.",
			checkedAt: Date.now(),
		};
	}

	const result = spawnSync(resolved.path, buildLinuxProbeArgs(probeCommandPath), {
		encoding: "utf-8",
		timeout: 5000,
	});

	if (result.error) {
		const classified = classifyLinuxProbeFailure(result.stderr ?? "", (result.error as NodeJS.ErrnoException).code);
		return {
			status: "unavailable",
			backend: resolved.backend,
			platform: process.platform,
			binaryPath: resolved.path,
			reason: classified.reason,
			details: result.error.message || classified.details,
			checkedAt: Date.now(),
		};
	}

	if (result.status !== 0) {
		const classified = classifyLinuxProbeFailure(result.stderr ?? "");
		return {
			status: "unavailable",
			backend: resolved.backend,
			platform: process.platform,
			binaryPath: resolved.path,
			reason: classified.reason,
			details: classified.details,
			checkedAt: Date.now(),
		};
	}

	return {
		status: "available",
		backend: resolved.backend,
		platform: process.platform,
		binaryPath: resolved.path,
		checkedAt: Date.now(),
	};
}

function probeMacosSandbox(): SandboxCapability {
	const sandboxExecPath = resolveMacosSandboxExecPath();
	if (!sandboxExecPath) {
		return {
			status: "unavailable",
			backend: "macos-seatbelt",
			platform: process.platform,
			reason: "binary_not_found",
			details: "Could not locate /usr/bin/sandbox-exec or sandbox-exec on PATH.",
			checkedAt: Date.now(),
		};
	}

	const result = spawnSync(sandboxExecPath, ["-p", buildMacosProbeProfile(), "/usr/bin/true"], {
		encoding: "utf-8",
		timeout: 5000,
	});

	if (result.error) {
		return {
			status: "unavailable",
			backend: "macos-seatbelt",
			platform: process.platform,
			binaryPath: sandboxExecPath,
			reason:
				(result.error as NodeJS.ErrnoException).code === "EACCES"
					? "binary_not_executable"
					: "probe_command_failed",
			details: result.error.message,
			checkedAt: Date.now(),
		};
	}

	if (result.status !== 0) {
		return {
			status: "unavailable",
			backend: "macos-seatbelt",
			platform: process.platform,
			binaryPath: sandboxExecPath,
			reason: "probe_command_failed",
			details: result.stderr || "The macOS sandbox probe command failed.",
			checkedAt: Date.now(),
		};
	}

	return {
		status: "available",
		backend: "macos-seatbelt",
		platform: process.platform,
		binaryPath: sandboxExecPath,
		checkedAt: Date.now(),
	};
}

async function probeSandboxCapability(): Promise<SandboxCapability> {
	try {
		if (process.platform === "linux") {
			sandboxCapability = probeLinuxSandbox();
			return sandboxCapability;
		}
		if (process.platform === "darwin") {
			sandboxCapability = probeMacosSandbox();
			return sandboxCapability;
		}
		if (process.platform === "win32") {
			sandboxCapability = await probeWindowsSandbox();
			return sandboxCapability;
		}

		sandboxCapability = {
			status: "unavailable",
			backend: null,
			platform: process.platform,
			reason: "unsupported_platform",
			details: `Sandbox probe skipped on platform ${process.platform}.`,
			checkedAt: Date.now(),
		};
		return sandboxCapability;
	} catch (error) {
		sandboxCapability = {
			status: "unavailable",
			backend: null,
			platform: process.platform,
			reason: "unknown_error",
			details: error instanceof Error ? error.message : String(error),
			checkedAt: Date.now(),
		};
		return sandboxCapability;
	}
}

export function initializeSandboxCapability(): Promise<SandboxCapability> {
	if (sandboxInitializationPromise) return sandboxInitializationPromise;
	sandboxInitializationPromise = probeSandboxCapability().finally(() => {
		sandboxInitializationPromise = undefined;
	});
	return sandboxInitializationPromise;
}

export async function initializeLinuxSandboxCapability(): Promise<LinuxSandboxCapability> {
	const capability = await initializeSandboxCapability();
	return {
		...capability,
		backend:
			capability.backend === "bundled-bwrap" || capability.backend === "system-bwrap" ? capability.backend : null,
	};
}

export function getSandboxCapability(): SandboxCapability {
	return { ...sandboxCapability };
}

export function getLinuxSandboxCapability(): LinuxSandboxCapability {
	return {
		...sandboxCapability,
		backend:
			sandboxCapability.backend === "bundled-bwrap" || sandboxCapability.backend === "system-bwrap"
				? sandboxCapability.backend
				: null,
	};
}

export function getAvailableLinuxBubblewrapPath(): string | undefined {
	return sandboxCapability.backend === "bundled-bwrap" || sandboxCapability.backend === "system-bwrap"
		? sandboxCapability.binaryPath
		: undefined;
}

export function getAvailableMacosSandboxExecPath(): string | undefined {
	return sandboxCapability.status === "available" && sandboxCapability.backend === "macos-seatbelt"
		? sandboxCapability.binaryPath
		: undefined;
}

export function formatSandboxUnavailableMessage(capability: SandboxCapability): string {
	const reason = capability.reason ?? "unknown_error";
	const details = capability.details ? `\n${capability.details}` : "";
	const binaryPath = capability.binaryPath ? `\npath=${resolvePath(capability.binaryPath)}` : "";
	return `Sandbox is unavailable on ${capability.platform} (${reason}).${binaryPath}${details}`;
}

export function formatLinuxSandboxUnavailableMessage(capability: LinuxSandboxCapability): string {
	const reason = capability.reason ?? "unknown_error";
	const details = capability.details ? `\n${capability.details}` : "";
	const binaryPath = capability.binaryPath ? `\npath=${resolvePath(capability.binaryPath)}` : "";
	return `Linux sandbox is unavailable (${reason}).${binaryPath}${details}`;
}

export async function assertSandboxAvailableForMode(
	requestedMode: SessionExecutionMode | undefined,
	resolveDefaultMode: () => Promise<SessionExecutionMode>,
): Promise<void> {
	const effectiveMode = requestedMode ?? (await resolveDefaultMode());
	if (effectiveMode !== "sandbox") return;
	if (sandboxCapability.status === "unknown") {
		await initializeSandboxCapability();
	}
	if (sandboxCapability.status === "available") return;
	throw new Error(formatSandboxUnavailableMessage(sandboxCapability));
}

export async function assertLinuxSandboxAvailableForMode(
	requestedMode: SessionExecutionMode | undefined,
	resolveDefaultMode: () => Promise<SessionExecutionMode>,
): Promise<void> {
	if (process.platform !== "linux") return;
	await assertSandboxAvailableForMode(requestedMode, resolveDefaultMode);
}
