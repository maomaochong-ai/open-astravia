import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentRpcExecutable {
	readonly path: string;
	dispose(): Promise<void>;
}

const sourceEntryPath = fileURLToPath(new URL("../../src/agent-rpc-cli.ts", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const testBundleRoot = join(repositoryRoot, "node_modules", ".cache");

export async function buildAgentRpcExecutable(): Promise<AgentRpcExecutable> {
	await mkdir(testBundleRoot, { recursive: true });
	const directory = await mkdtemp(join(testBundleRoot, "vetta-agent-rpc-"));
	const path = join(directory, "agent-rpc.mjs");
	try {
		await runCommand(
			"bun",
			["build", sourceEntryPath, "--target", "bun", "--external", "@mariozechner/jiti", "--outfile", path],
			repositoryRoot,
		);
		await copyFile(join(repositoryRoot, "packages", "coding-agent", "package.json"), join(directory, "package.json"));
		return {
			path,
			dispose: () => rm(directory, { force: true, recursive: true }),
		};
	} catch (error) {
		await rm(directory, { force: true, recursive: true });
		throw error;
	}
}

async function runCommand(command: string, args: readonly string[], cwd: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`Command failed with code ${code}, signal ${signal}\n${stderr}`));
		});
	});
}
