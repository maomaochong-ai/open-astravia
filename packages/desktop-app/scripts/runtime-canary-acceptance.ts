import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { runtimeCanarySuccessEnvelopeSchema } from "../src/main/app-debug/runtime-canary/contracts.js";

const desktopRoot = join(import.meta.dirname, "..");
const verificationStatusSchema = z
	.object({
		hostPid: z.number().int().positive().nullable(),
		running: z.boolean(),
	})
	.loose();

try {
	await ensureNoVerificationHost();
	const result = await runRuntimeCanary();
	printJson(result);
} catch (error) {
	printJson({
		ok: false,
		error: {
			code: "RUNTIME_CANARY_ACCEPTANCE_ERROR",
			message: error instanceof Error ? error.message : String(error),
		},
	});
	process.exitCode = 1;
}

async function runRuntimeCanary(): Promise<z.infer<typeof runtimeCanarySuccessEnvelopeSchema>> {
	const host = spawn("bun", ["run", "verify:ui:start", "--runtime-canary"], {
		cwd: desktopRoot,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	let hostOutput = "";
	host.stdout.on("data", (chunk: Buffer) => {
		hostOutput = appendTail(hostOutput, chunk.toString("utf8"));
	});
	host.stderr.on("data", (chunk: Buffer) => {
		hostOutput = appendTail(hostOutput, chunk.toString("utf8"));
	});
	try {
		await waitForVerificationReady(host);
		const debug = await runProcess("bun", ["run", "verify:ui:debug", "runtime-canary"]);
		if (debug.code !== 0) {
			throw new Error(`Runtime Canary failed with code ${debug.code}\n${debug.stdout}\n${debug.stderr}\n${hostOutput}`);
		}
		const envelope = parseJsonLine(debug.stdout, runtimeCanarySuccessEnvelopeSchema);
		await waitForHostExit(host, 30_000);
		if (host.exitCode !== 0) {
			throw new Error(`Runtime Canary host exited with code ${host.exitCode}\n${hostOutput}`);
		}
		return envelope;
	} catch (error) {
		await runProcess("bun", ["run", "verify:ui:stop"]).catch(() => undefined);
		await waitForHostExit(host, 10_000).catch(() => undefined);
		throw error;
	}
}

async function ensureNoVerificationHost(): Promise<void> {
	const status = await runProcess("bun", ["run", "verify:ui:status"]);
	const parsed = parseJsonLine(status.stdout, verificationStatusSchema);
	if (parsed.hostPid !== null) {
		throw new Error(`UI verification host is already active with pid ${parsed.hostPid}`);
	}
}

async function waitForVerificationReady(host: ChildProcess): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < 120_000) {
		if (host.exitCode !== null || host.signalCode !== null) {
			throw new Error("UI verification host exited before becoming ready");
		}
		const status = await runProcess("bun", ["run", "verify:ui:status"]);
		try {
			const parsed = parseJsonLine(status.stdout, verificationStatusSchema);
			if (status.code === 0 && parsed.running) return;
		} catch {
			// Desktop and the installed CLI are still starting.
		}
		await delay(500);
	}
	throw new Error("Timed out waiting for the UI verification host");
}

async function waitForHostExit(host: ChildProcess, timeoutMs: number): Promise<void> {
	if (host.exitCode !== null || host.signalCode !== null) return;
	await Promise.race([
		new Promise<void>((resolve) => host.once("exit", () => resolve())),
		delay(timeoutMs).then(() => {
			throw new Error("Timed out waiting for UI verification host to exit");
		}),
	]);
}

async function runProcess(
	command: string,
	args: string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: desktopRoot,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (signal) {
				reject(new Error(`${command} exited with signal ${signal}\n${stderr}`));
				return;
			}
			resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
		});
	});
}

function parseJsonLine<T>(stdout: string, schema: z.ZodType<T>): T {
	for (const line of stdout.split(/\r?\n/).reverse()) {
		const candidate = line.trim();
		if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
		try {
			return schema.parse(JSON.parse(candidate));
		} catch {
			// Continue past Bun command traces and unrelated JSON logs.
		}
	}
	throw new Error(`Command did not return the expected JSON contract:\n${stdout}`);
}

function appendTail(current: string, next: string): string {
	return `${current}${next}`.slice(-50_000);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
