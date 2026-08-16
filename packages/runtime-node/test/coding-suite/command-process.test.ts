import { execPath } from "node:process";
import { describe, expect, it } from "vitest";
import { createNodeCommandProcessHost, NodeCommandProcessAbortedError } from "../../src/coding/index.js";

describe("Node command process host", () => {
	const host = createNodeCommandProcessHost();

	it("returns stdout, stderr and non-zero exit codes without rejecting", async () => {
		const success = await host.run(execPath, ["-e", "process.stdout.write('hello')"], { timeoutMs: 5_000 });
		const failure = await host.run(execPath, ["-e", "process.stderr.write('boom');process.exit(3)"], {
			timeoutMs: 5_000,
		});
		expect(success).toEqual({ stdout: "hello", stderr: "", code: 0 });
		expect(failure).toEqual({ stdout: "", stderr: "boom", code: 3 });
	});

	it("aborts active and already-aborted requests", async () => {
		const controller = new AbortController();
		const active = host.run(execPath, ["-e", "setTimeout(() => {}, 60000)"], {
			signal: controller.signal,
			timeoutMs: 60_000,
		});
		setTimeout(() => controller.abort(), 50);
		await expect(active).rejects.toBeInstanceOf(NodeCommandProcessAbortedError);

		const alreadyAborted = new AbortController();
		alreadyAborted.abort();
		await expect(
			host.run(execPath, ["-e", "process.exit(0)"], {
				signal: alreadyAborted.signal,
				timeoutMs: 5_000,
			}),
		).rejects.toBeInstanceOf(NodeCommandProcessAbortedError);
	});

	it("kills timed-out and output-overflow processes", async () => {
		await expect(host.run(execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 100 })).rejects.toThrow(
			"Process timed out after 100ms",
		);
		await expect(
			host.run(execPath, ["-e", "process.stdout.write('12345')"], {
				timeoutMs: 5_000,
				maxBufferBytes: 4,
			}),
		).rejects.toThrow("Process output exceeded 4 bytes");
	});
});
