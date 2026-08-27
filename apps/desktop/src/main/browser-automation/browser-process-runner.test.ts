import { describe, expect, it } from "vitest";
import { BrowserProcessAbortedError, HostBrowserProcessRunner } from "./browser-process-runner.js";

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
});
