import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const WINDOWS_SANDBOX_HOST_FILENAME = "codex-windows-sandbox-host.exe";

export type WindowsSandboxBackend = "bundled-host" | "configured-host";

export interface ResolvedWindowsSandboxHostBinary {
	path: string;
	backend: WindowsSandboxBackend;
}

function resolveBundledWindowsSandboxHostPath(): string {
	if (app.isPackaged) {
		return join(process.resourcesPath, "sandbox", "windows", WINDOWS_SANDBOX_HOST_FILENAME);
	}

	return join(process.cwd(), "..", "..", "packages", "runtime-core", "sandbox", "bin", WINDOWS_SANDBOX_HOST_FILENAME);
}

export function resolveWindowsSandboxHostBinary(): ResolvedWindowsSandboxHostBinary | undefined {
	const explicitPath = process.env.VETTA_WINDOWS_SANDBOX_HOST_PATH?.trim();

	if (explicitPath) {
		if (!existsSync(explicitPath)) {
			throw new Error(`Configured Windows sandbox host does not exist: ${explicitPath}`);
		}
		return {
			path: explicitPath,
			backend: "configured-host",
		};
	}

	const bundledPath = resolveBundledWindowsSandboxHostPath();
	if (existsSync(bundledPath)) {
		return {
			path: bundledPath,
			backend: "bundled-host",
		};
	}

	return undefined;
}
