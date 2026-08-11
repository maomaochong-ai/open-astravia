import { execPath } from "node:process";
import { describe, expect, it } from "vitest";
import {
	CodingAgentCommandProcessAbortedError,
	createCodingAgentCommandProcessHost,
} from "../../src/adapters/runtime-tools/command-process-host.js";

describe("Coding Agent command process host", () => {
	const host = createCodingAgentCommandProcessHost();

	it("returns stdout, stderr and non-zero exit codes without rejecting", async () => {
		const success = await host.run(execPath, ["-e", "process.stdout.write('hello')"], { timeoutMs: 5_000 });
		const failure = await host.run(execPath, ["-e", "process.stderr.write('boom');process.exit(3)"], {
			timeoutMs: 5_000,
		});

		expect(success).toEqual({ stdout: "hello", stderr: "", code: 0 });
		expect(failure).toEqual({ stdout: "", stderr: "boom", code: 3 });
	});

	it("aborts an active process and rejects an already-aborted request", async () => {
		const controller = new AbortController();
		const active = host.run(execPath, ["-e", "setTimeout(() => {}, 60000)"], {
			signal: controller.signal,
			timeoutMs: 60_000,
		});
		setTimeout(() => controller.abort(), 50);
		await expect(active).rejects.toBeInstanceOf(CodingAgentCommandProcessAbortedError);

		const alreadyAborted = new AbortController();
		alreadyAborted.abort();
		await expect(
			host.run(execPath, ["-e", "process.exit(0)"], {
				signal: alreadyAborted.signal,
				timeoutMs: 5_000,
			}),
		).rejects.toBeInstanceOf(CodingAgentCommandProcessAbortedError);
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
