import { spawn, spawnSync } from "node:child_process";
import type { ResourcePackageCommandPort, ResourcePackageRegistryPort } from "../contracts/resource-source.js";

const NETWORK_TIMEOUT_MS = 10000;

export function isResourcePackageOffline(): boolean {
	const value = process.env.PI_OFFLINE;
	return Boolean(value && (value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes"));
}

export class NodeResourcePackageCommands implements ResourcePackageCommandPort {
	run(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
		return new Promise((resolvePromise, reject) => {
			const child = spawn(command, args, {
				cwd: options?.cwd,
				stdio: "inherit",
				shell: process.platform === "win32",
			});
			child.on("error", reject);
			child.on("exit", (code) => {
				if (code === 0) resolvePromise();
				else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
			});
		});
	}

	runSync(command: string, args: string[]): string {
		const result = spawnSync(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf-8",
			shell: process.platform === "win32",
		});
		if (result.status !== 0) {
			throw new Error(`Failed to run ${command} ${args.join(" ")}: ${result.stderr || result.stdout}`);
		}
		return (result.stdout || result.stderr || "").trim();
	}
}

export class NpmResourcePackageRegistry implements ResourcePackageRegistryPort {
	async getLatestVersion(packageName: string): Promise<string> {
		const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
			signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`Failed to fetch npm registry: ${response.status}`);
		const data = (await response.json()) as { version: string };
		return data.version;
	}
}
