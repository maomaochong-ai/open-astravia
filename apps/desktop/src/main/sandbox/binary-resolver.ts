import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export type LinuxSandboxBackend = "bundled-bwrap" | "system-bwrap";

export interface ResolvedLinuxBubblewrapBinary {
	path: string;
	backend: LinuxSandboxBackend;
	arch: string;
}

function assertExecutable(path: string): void {
	accessSync(path, constants.X_OK);
}

function findOnPathUnix(binary: string): string | undefined {
	const pathValue = process.env.PATH;
	if (!pathValue) return undefined;

	for (const entry of pathValue.split(process.platform === "win32" ? ";" : ":")) {
		if (!entry) continue;
		const candidate = join(entry, binary);
		if (!existsSync(candidate)) continue;
		try {
			assertExecutable(candidate);
			return candidate;
		} catch {
			// Ignore non-executable matches.
		}
	}

	return undefined;
}

function resolveBundledBubblewrapPath(): string {
	const arch = process.arch;
	if (app.isPackaged) {
		return join(process.resourcesPath, "sandbox", "linux", arch, "bwrap");
	}
	return join(process.cwd(), "..", "..", "packages", "runtime-core", "sandbox", "linux", arch, "bwrap");
}

export function resolveLinuxBubblewrapBinary(): ResolvedLinuxBubblewrapBinary | undefined {
	const arch = process.arch;
	const explicitPath = process.env.VETTA_LINUX_BWRAP_PATH?.trim();

	if (explicitPath) {
		if (!existsSync(explicitPath)) {
			throw new Error(`Configured Linux sandbox binary does not exist: ${explicitPath}`);
		}
		assertExecutable(explicitPath);
		return {
			path: explicitPath,
			backend: "system-bwrap",
			arch,
		};
	}

	const bundledPath = resolveBundledBubblewrapPath();
	if (existsSync(bundledPath)) {
		assertExecutable(bundledPath);
		return {
			path: bundledPath,
			backend: "bundled-bwrap",
			arch,
		};
	}

	for (const binary of ["bwrap", "bubblewrap"]) {
		const resolved = findOnPathUnix(binary);
		if (resolved) {
			return {
				path: resolved,
				backend: "system-bwrap",
				arch,
			};
		}
	}

	return undefined;
}
