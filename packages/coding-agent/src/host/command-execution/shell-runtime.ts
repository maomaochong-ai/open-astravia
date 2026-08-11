import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, delimiter } from "node:path";
import { getBinDir, getSettingsPath } from "../../config.js";
import { SettingsRuntime } from "../../settings/index.js";

export interface ShellCommand {
	readonly shell: string;
	readonly args: string[];
}

let cachedShellCommand: ShellCommand | undefined;

export const WINDOWS_POWERSHELL_UTF8_COMMAND_PREFIX = [
	"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
	"$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
	'$PSDefaultParameterValues["Get-Content:Encoding"] = "UTF8"',
].join("\n");

export function isWindowsPowerShellShell(shellPath: string): boolean {
	const shellName = basename(shellPath).toLowerCase();
	return ["powershell.exe", "powershell", "pwsh.exe", "pwsh"].includes(shellName);
}

export function getDefaultShellCommandPrefix(shellPath: string): string | undefined {
	return process.platform === "win32" && isWindowsPowerShellShell(shellPath)
		? WINDOWS_POWERSHELL_UTF8_COMMAND_PREFIX
		: undefined;
}

export function prependCommandPrefixes(command: string, prefixes: Array<string | undefined>): string {
	return [...prefixes.filter((prefix): prefix is string => Boolean(prefix?.trim())), command].join("\n");
}

export function getShellConfig(): ShellCommand {
	if (cachedShellCommand) return cachedShellCommand;

	const customShellPath = SettingsRuntime.create().getShellPath();
	if (customShellPath) {
		if (!existsSync(customShellPath)) {
			throw new Error(
				`Custom shell path not found: ${customShellPath}\nPlease update shellPath in ${getSettingsPath()}`,
			);
		}
		cachedShellCommand = { shell: customShellPath, args: ["-c"] };
		return cachedShellCommand;
	}

	if (process.platform === "win32") {
		const pwsh = findExecutableOnWindows("pwsh.exe");
		if (pwsh) {
			cachedShellCommand = { shell: pwsh, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] };
			return cachedShellCommand;
		}
		const powershell = findExecutableOnWindows("powershell.exe");
		if (powershell) {
			cachedShellCommand = {
				shell: powershell,
				args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"],
			};
			return cachedShellCommand;
		}
		cachedShellCommand = { shell: findExecutableOnWindows("cmd.exe") ?? "cmd.exe", args: ["/d", "/s", "/c"] };
		return cachedShellCommand;
	}

	if (existsSync("/bin/bash")) {
		cachedShellCommand = { shell: "/bin/bash", args: ["-c"] };
		return cachedShellCommand;
	}
	const bash = findBashOnPathUnix();
	cachedShellCommand = bash ? { shell: bash, args: ["-c"] } : { shell: "sh", args: ["-c"] };
	return cachedShellCommand;
}

export function getShellEnv(): NodeJS.ProcessEnv {
	const binDirectory = getBinDir();
	const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const currentPath = process.env[pathKey] ?? "";
	const hasBinDirectory = currentPath.split(delimiter).filter(Boolean).includes(binDirectory);
	return {
		...process.env,
		[pathKey]: hasBinDirectory ? currentPath : [binDirectory, currentPath].filter(Boolean).join(delimiter),
	};
}

function findExecutableOnWindows(command: string): string | null {
	try {
		const result = spawnSync("where", [command], { encoding: "utf-8", timeout: 5_000 });
		const firstMatch = result.status === 0 && result.stdout ? result.stdout.trim().split(/\r?\n/)[0] : undefined;
		return firstMatch && existsSync(firstMatch) ? firstMatch : null;
	} catch {
		return null;
	}
}

function findBashOnPathUnix(): string | null {
	try {
		const result = spawnSync("which", ["bash"], { encoding: "utf-8", timeout: 5_000 });
		return result.status === 0 && result.stdout ? (result.stdout.trim().split(/\r?\n/)[0] ?? null) : null;
	} catch {
		return null;
	}
}
