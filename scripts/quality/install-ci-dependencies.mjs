import { spawn } from "node:child_process";
import { isDirectRun } from "./lib.mjs";

const DEFAULT_MAX_ATTEMPTS = 3;

function runInheritedCommand(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
	});
}

function wait(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function installCiDependencies(options = {}) {
	const runCommand = options.runCommand ?? runInheritedCommand;
	const delay = options.delay ?? wait;
	const log = options.log ?? console.log;
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		log(`Installing Bun dependencies (attempt ${attempt}/${maxAttempts})`);
		const exitCode = await runCommand("bun", ["install", "--frozen-lockfile"]);
		if (exitCode === 0) return;

		if (attempt === maxAttempts) {
			throw new Error(`Bun dependency installation failed after ${maxAttempts} attempts.`);
		}

		log("::warning::Bun dependency installation failed; clearing the runner cache before retrying.");
		await runCommand("bun", ["pm", "cache", "rm"]);
		await delay(attempt * 2_000);
	}
}

if (isDirectRun(import.meta.url)) {
	installCiDependencies().catch((error) => {
		console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
