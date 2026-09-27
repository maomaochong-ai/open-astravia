import { describe, expect, it } from "vitest";
import { BrowserProcessAbortedError, HostBrowserProcessRunner } from "./browser-process-runner.js";

describe("HostBrowserProcessRunner", () => {
	it("runs a real command and returns stdout", async () => {
		const runner = new HostBrowserProcessRunner();
		const result = await runner.run("echo", ["hello"], { timeoutMs: 5_000 });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("hello");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("returns exit code for failing command", async () => {
		const runner = new HostBrowserProcessRunner();
		const result = await runner.run("node", ["-e", "process.exit(42)"], { timeoutMs: 5_000 });
		expect(result.exitCode).toBe(42);
	});

	it("kills on timeout", async () => {
		const runner = new HostBrowserProcessRunner();
		await expect(runner.run("node", ["-e", "setInterval(()=>{}, 100)"], { timeoutMs: 50 })).rejects.toThrow(
			/timed out/,
		);
	});

	it("kills on AbortSignal", async () => {
		const runner = new HostBrowserProcessRunner();
		const controller = new AbortController();
		const promise = runner.run("node", ["-e", "setInterval(()=>{}, 100)"], {
			timeoutMs: 10_000,
			signal: controller.signal,
		});
		controller.abort();
		await expect(promise).rejects.toBeInstanceOf(BrowserProcessAbortedError);
	});

	it("respects maxOutputChars bound", async () => {
		const runner = new HostBrowserProcessRunner();
		const result = await runner.run("node", ["-e", "process.stdout.write('a'.repeat(500))"], {
			timeoutMs: 5_000,
			maxOutputChars: 100,
		});
		expect(result.stdout.length).toBeLessThanOrEqual(100);
		expect(result.truncated).toBe(true);
	});
});
