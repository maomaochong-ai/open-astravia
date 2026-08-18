import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	type ManagedNodeCommandPaths,
	resolveCommandInvocation,
	spawnCrossPlatformCommand,
} from "./command-launcher.js";

const existingPaths: ManagedNodeCommandPaths = {
	node: process.execPath,
	npmCli: process.execPath,
	npxCli: process.execPath,
};
const testRoot = join(process.cwd(), `.tmp-command-launcher-${process.pid}`);

afterAll(async () => {
	await rm(testRoot, { recursive: true, force: true });
});

describe("plugin command launcher", () => {
	it("maps npm and npx to the managed Node runtime", () => {
		expect(resolveCommandInvocation("npm", ["install"], existingPaths)).toEqual({
			file: process.execPath,
			args: [process.execPath, "install"],
		});
		expect(resolveCommandInvocation("npx", ["vite"], existingPaths)).toEqual({
			file: process.execPath,
			args: [process.execPath, "vite"],
		});
	});

	it("maps node itself to the managed executable", () => {
		expect(resolveCommandInvocation("node", ["--version"], existingPaths)).toEqual({
			file: process.execPath,
			args: ["--version"],
		});
	});

	it("preserves logical commands when the managed runtime is unavailable", () => {
		const missingPaths: ManagedNodeCommandPaths = {
			node: join(testRoot, "missing-node"),
			npmCli: join(testRoot, "missing-npm-cli.js"),
			npxCli: join(testRoot, "missing-npx-cli.js"),
		};
		expect(resolveCommandInvocation("npm", ["--version"], missingPaths)).toEqual({
			file: "npm",
			args: ["--version"],
		});
		expect(resolveCommandInvocation("git", ["status"], existingPaths)).toEqual({
			file: "git",
			args: ["status"],
		});
	});

	it.runIf(process.platform === "win32")("launches Windows cmd shims without caller shell mode", async () => {
		const shimDir = join(testRoot, "cmd shim");
		const shimPath = join(shimDir, "test-tool.cmd");
		await mkdir(shimDir, { recursive: true });
		await writeFile(shimPath, "@echo off\r\necho shim-ready\r\n");

		const child = spawnCrossPlatformCommand(shimPath, [], {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
			child.once("error", rejectExit);
			child.once("close", resolveExit);
		});

		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("shim-ready");
	});
});
