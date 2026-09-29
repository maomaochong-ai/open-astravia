import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const WINDOWS_SANDBOX_BINARY_NAMES = Object.freeze([
	"codex-windows-sandbox-host.exe",
	"codex-windows-sandbox-setup.exe",
	"codex-command-runner.exe",
]);

export function stageWindowsSandboxBinaries({ sourceDir, destinationDir }) {
	const missing = WINDOWS_SANDBOX_BINARY_NAMES.filter(
		(binaryName) => !existsSync(join(sourceDir, binaryName)),
	);
	if (missing.length > 0) {
		throw new Error(
			`[prepare-pack] required Windows sandbox binaries are missing from ${sourceDir}: ${missing.join(", ")}`,
		);
	}

	mkdirSync(destinationDir, { recursive: true });
	for (const binaryName of WINDOWS_SANDBOX_BINARY_NAMES) {
		const destinationPath = join(destinationDir, binaryName);
		copyFileSync(join(sourceDir, binaryName), destinationPath);
		try {
			chmodSync(destinationPath, 0o755);
		} catch {
			// best effort on Windows / FAT
		}
	}
}
