import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { BrowserProcessAbortedError, HostBrowserProcessRunner } from "./browser-process-runner.js";

function fakeChildProcess(): { child: ChildProcess; stdout: PassThrough; stderr: PassThrough } {
	const child = new EventEmitter() as ChildProcess;
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	Object.assign(child, {
		stdout,
		stderr,
		kill: vi.fn(() => true),
	});
	return { child, stdout, stderr };
}

describe("HostBrowserProcessRunner cancellation", () => {
	it("kills and rejects an in-flight child process when the capability is cancelled", async () => {
		const controller = new AbortController();
		const runner = new HostBrowserProcessRunner();
		const running = runner.run(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
			timeoutMs: 30_000,
			signal: controller.signal,
		});
		controller.abort();
		await expect(running).rejects.toBeInstanceOf(BrowserProcessAbortedError);
	});

	it("settles when a daemonizing command exits while inherited output pipes remain open", async () => {
		const { child, stdout, stderr } = fakeChildProcess();
		const runner = new HostBrowserProcessRunner(() => child);
		const running = runner.run("agent-browser", ["open", "https://example.com"], { timeoutMs: 30_000 });

		stdout.write("opened\n");
		child.emit("exit", 0, null);

		await expect(running).resolves.toMatchObject({ exitCode: 0, stdout: "opened\n" });
		expect(stdout.destroyed).toBe(true);
		expect(stderr.destroyed).toBe(true);
	});

	it("rejects immediately on timeout even when the killed process never closes its inherited pipes", async () => {
		vi.useFakeTimers();
		try {
			const { child } = fakeChildProcess();
			const runner = new HostBrowserProcessRunner(() => child);
			const running = runner.run("agent-browser", ["open", "https://example.com"], { timeoutMs: 100 });
			const assertion = expect(running).rejects.toThrow("Browser process timed out after 100ms");

			await vi.advanceTimersByTimeAsync(100);
			await assertion;
			expect(child.kill).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});
});
