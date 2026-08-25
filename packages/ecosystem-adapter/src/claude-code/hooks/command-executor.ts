import { accessSync, constants } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { NodeHookCommandExecutor } from "../../hooks/node-command-executor.js";
import type { HookCommandExecutionRequest, HookCommandExecutor, HookCommandResult } from "../../hooks/types.js";

/**
 * Claude command executor:
 * - Prefer Git Bash / real bash for `.sh` and bash shebang commands on Windows
 * - Never silently hand `.sh` to cmd.exe
 * - Fall back to platform default shell for non-shell scripts (node, etc.)
 */
export class ClaudeHookCommandExecutor implements HookCommandExecutor {
	private readonly defaultExecutor = new NodeHookCommandExecutor();
	private readonly bashExecutor: HookCommandExecutor | undefined;

	constructor() {
		const bashPath = findBashExecutable();
		this.bashExecutor = bashPath
			? new NodeHookCommandExecutor({ shellProgram: bashPath, shellArgs: ["-lc"] })
			: undefined;
	}

	async execute(request: HookCommandExecutionRequest, signal?: AbortSignal): Promise<HookCommandResult> {
		const needsBash = commandNeedsBash(request.command);
		if (needsBash) {
			if (!this.bashExecutor) {
				return runtimeFailure(
					"Claude hook requires Bash to run shell scripts; Bash was not found (install Git Bash or set VETTA_BASH)",
				);
			}
			// Ensure the script path is absolute when possible so bash -lc can find it after cd.
			const normalized = normalizeShellCommand(request.command, request.cwd);
			const command =
				request.args === undefined
					? normalized
					: [quoteBashToken(normalized), ...request.args.map(quoteBashToken)].join(" ");
			return this.bashExecutor.execute({ ...request, command, args: undefined }, signal);
		}
		return this.defaultExecutor.execute(request, signal);
	}
}

function quoteBashToken(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandNeedsBash(command: string): boolean {
	const trimmed = command.trim();
	if (trimmed.startsWith("bash ") || trimmed.startsWith("sh ")) return true;
	const firstToken = firstCommandToken(trimmed);
	if (!firstToken) return false;
	const ext = extname(firstToken.replace(/^["']|["']$/g, "")).toLowerCase();
	return ext === ".sh" || ext === ".bash";
}

function firstCommandToken(command: string): string | undefined {
	const match = /^("([^"]+)"|'([^']+)'|(\S+))/.exec(command);
	if (!match) return undefined;
	return match[2] ?? match[3] ?? match[4];
}

function normalizeShellCommand(command: string, cwd: string): string {
	const trimmed = command.trim();
	const token = firstCommandToken(trimmed);
	if (!token) return trimmed;
	const bare = token.replace(/^["']|["']$/g, "");
	if (isAbsolute(bare) || !bare.endsWith(".sh")) return trimmed;
	const absolute = resolve(cwd, bare);
	if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
		return trimmed.replace(token, `"${absolute}"`);
	}
	return `"${absolute}"${trimmed.slice(token.length)}`;
}

function findBashExecutable(): string | undefined {
	const candidates = [
		process.env.VETTA_BASH,
		process.env.GIT_BASH,
		"C:\\Program Files\\Git\\bin\\bash.exe",
		"C:\\Program Files\\Git\\usr\\bin\\bash.exe",
		"C:\\Program Files (x86)\\Git\\bin\\bash.exe",
	].filter((value): value is string => typeof value === "string" && value.length > 0);

	for (const candidate of candidates) {
		if (isExecutable(candidate)) return candidate;
	}

	// Avoid Windows Store / WSL launcher stubs that only forward into WSL without Git tools.
	if (process.platform === "win32") {
		const pathEntries = (process.env.PATH ?? "").split(";");
		for (const entry of pathEntries) {
			const candidate = resolve(entry, "bash.exe");
			if (candidate.toLowerCase().includes("windows\\system32")) continue;
			if (isExecutable(candidate)) return candidate;
		}
		return undefined;
	}

	for (const candidate of ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"]) {
		if (isExecutable(candidate)) return candidate;
	}
	return undefined;
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.F_OK);
		// On Windows access X_OK is unreliable; existence is enough for known bash paths.
		return true;
	} catch {
		return false;
	}
}

function runtimeFailure(message: string): HookCommandResult {
	const now = Date.now();
	return {
		startedAt: Math.floor(now / 1000),
		completedAt: Math.floor(now / 1000),
		durationMs: 0,
		exitCode: null,
		stdout: "",
		stderr: "",
		error: { code: "spawn_failed", message },
	};
}
