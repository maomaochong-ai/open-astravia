import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Locates the signal-cli executable the user installed.
 *
 * Signal has no bot API, so the bridge drives signal-cli. The gateway
 * sidecar performs the same search (apps/im-gateway/internal/transport/
 * signal/cli.go — keep the two lists in sync), but the settings UI needs
 * the answer *before* any sidecar runs: to show "已安装 / 未安装", the
 * install command, and to hand the resolved path down so a GUI process
 * with a minimal PATH still finds a Homebrew install.
 */

export interface SignalCliDetection {
	/** Absolute path to the executable, or undefined when nothing matched. */
	path?: string;
	/** The command that installs it on this platform. */
	installHint: string;
	/** Where the hit came from — useful in logs and support threads. */
	source?: "explicit" | "path" | "well-known";
}

/** Executable names to try, most specific first. */
function executableNames(): string[] {
	return process.platform === "win32"
		? ["signal-cli.bat", "signal-cli.exe", "signal-cli", "signal-cli.cmd"]
		: ["signal-cli"];
}

/**
 * Well-known install locations per platform. These matter because a
 * launched .app inherits a minimal PATH that usually omits /opt/homebrew/bin.
 */
function wellKnownPaths(): string[] {
	const home = homedir();
	switch (process.platform) {
		case "darwin":
			return [
				"/opt/homebrew/bin/signal-cli",
				"/usr/local/bin/signal-cli",
				"/opt/local/bin/signal-cli",
				join(home, ".local", "bin", "signal-cli"),
			];
		case "win32": {
			const local = process.env.LOCALAPPDATA;
			const out: string[] = [];
			if (local) {
				out.push(
					join(local, "Programs", "signal-cli", "bin", "signal-cli.bat"),
					join(local, "Microsoft", "WinGet", "Links", "signal-cli.exe"),
				);
			}
			out.push(join(home, "scoop", "shims", "signal-cli.cmd"));
			return out;
		}
		default:
			return [
				"/usr/bin/signal-cli",
				"/usr/local/bin/signal-cli",
				"/snap/bin/signal-cli",
				"/var/lib/flatpak/exports/bin/signal-cli",
				join(home, ".local", "bin", "signal-cli"),
			];
	}
}

/** The one-line install command shown when nothing was found. */
export function signalCliInstallHint(): string {
	switch (process.platform) {
		case "darwin":
			return "brew install signal-cli";
		case "win32":
			return "scoop install signal-cli";
		default:
			return "https://github.com/AsamK/signal-cli/wiki";
	}
}

function isExecutableFile(candidate: string): boolean {
	try {
		if (!statSync(candidate).isFile()) return false;
	} catch {
		return false;
	}
	if (process.platform === "win32") return true;
	try {
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Directories from PATH, with the platform's separator. */
function pathDirs(): string[] {
	const raw = process.env.PATH ?? process.env.Path ?? "";
	return raw.split(delimiter).filter((dir) => dir !== "");
}

/**
 * Resolve signal-cli. An explicit path from settings wins (and is reported
 * as not-found when it does not resolve, rather than silently falling back
 * — a wrong override should be visible).
 */
export function detectSignalCli(explicitPath?: string): SignalCliDetection {
	const installHint = signalCliInstallHint();
	if (explicitPath) {
		return isExecutableFile(explicitPath) ? { path: explicitPath, installHint, source: "explicit" } : { installHint };
	}
	for (const dir of pathDirs()) {
		for (const name of executableNames()) {
			const candidate = join(dir, name);
			if (isExecutableFile(candidate)) {
				return { path: candidate, installHint, source: "path" };
			}
		}
	}
	for (const candidate of wellKnownPaths()) {
		if (isExecutableFile(candidate)) {
			return { path: candidate, installHint, source: "well-known" };
		}
	}
	return { installHint };
}
