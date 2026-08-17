import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, delimiter } from "node:path";

export interface NodeShellCommand {
	readonly executable: string;
	readonly args: readonly string[];
}

export interface ResolveNodeShellOptions {
	readonly customShellPath?: string;
	readonly settingsPath?: string;
	readonly platform?: NodeJS.Platform;
	readonly fileExists?: (path: string) => boolean;
	readonly findExecutable?: (command: string, platform: NodeJS.Platform) => string | undefined;
}

export const WINDOWS_POWERSHELL_UTF8_COMMAND_PREFIX = [
	"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
	"$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
	'$PSDefaultParameterValues["Get-Content:Encoding"] = "UTF8"',
].join("\n");

export function isWindowsPowerShellShell(shellPath: string): boolean {
	const shellName = basename(shellPath).toLowerCase();
	return ["powershell.exe", "powershell", "pwsh.exe", "pwsh"].includes(shellName);
}

export function getNodeShellCommandPrefix(
	shellPath: string,
	platform: NodeJS.Platform = process.platform,
): string | undefined {
	return platform === "win32" && isWindowsPowerShellShell(shellPath)
		? WINDOWS_POWERSHELL_UTF8_COMMAND_PREFIX
		: undefined;
}

export function prependCommandPrefixes(command: string, prefixes: Array<string | undefined>): string {
	return [...prefixes.filter((prefix): prefix is string => Boolean(prefix?.trim())), command].join("\n");
}

export function resolveNodeShell(options: ResolveNodeShellOptions = {}): NodeShellCommand {
	const platform = options.platform ?? process.platform;
	const fileExists = options.fileExists ?? existsSync;
	const findExecutable = options.findExecutable ?? defaultFindExecutable;
	if (options.customShellPath) {
		if (!fileExists(options.customShellPath)) {
			const location = options.settingsPath ? ` in ${options.settingsPath}` : "";
			throw new Error(`Custom shell path not found: ${options.customShellPath}\nPlease update shellPath${location}`);
		}
		return { executable: options.customShellPath, args: ["-c"] };
	}

	if (platform === "win32") {
		const pwsh = findExecutable("pwsh.exe", platform);
		if (pwsh) return { executable: pwsh, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] };
		const powershell = findExecutable("powershell.exe", platform);
		if (powershell) {
			return {
				executable: powershell,
				args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"],
			};
		}
		return { executable: findExecutable("cmd.exe", platform) ?? "cmd.exe", args: ["/d", "/s", "/c"] };
	}

	if (fileExists("/bin/bash")) return { executable: "/bin/bash", args: ["-c"] };
	const bash = findExecutable("bash", platform);
	return bash ? { executable: bash, args: ["-c"] } : { executable: "sh", args: ["-c"] };
}

export function createNodeShellEnvironment(
	binDirectory: string,
	environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const currentPath = environment[pathKey] ?? "";
	const hasBinDirectory = currentPath.split(delimiter).filter(Boolean).includes(binDirectory);
	return {
		...environment,
		[pathKey]: hasBinDirectory ? currentPath : [binDirectory, currentPath].filter(Boolean).join(delimiter),
	};
}

function defaultFindExecutable(command: string, platform: NodeJS.Platform): string | undefined {
	try {
		const lookup = platform === "win32" ? "where" : "which";
		const result = spawnSync(lookup, [command], { encoding: "utf-8", timeout: 5_000 });
		const firstMatch = result.status === 0 && result.stdout ? result.stdout.trim().split(/\r?\n/)[0] : undefined;
		return firstMatch && existsSync(firstMatch) ? firstMatch : undefined;
	} catch {
		return undefined;
	}
}
