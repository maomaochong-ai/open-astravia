import { describe, expect, it } from "vitest";
import { createNodeBackgroundCommandHost, createNodeForegroundCommandHost } from "../../src/coding/host/index.js";
import { createBackgroundCommandService } from "../../src/coding/shared/background-command-lifecycle.js";

const nodeShell = () => ({ executable: process.execPath, args: ["-e"] });

describe("Node local command host", () => {
	it("executes a foreground command through the injected shell", async () => {
		const host = createNodeForegroundCommandHost({ resolveShell: nodeShell });
		let output = "";
		const result = await host.operations.exec("process.stdout.write('foreground-ok')", process.cwd(), {
			onData: (data) => {
				output += Buffer.from(data).toString("utf8");
			},
			timeout: 10,
		});

		expect(result.exitCode).toBe(0);
		expect(output).toBe("foreground-ok");
	});

	it("owns background process output and normalization", async () => {
		const service = createBackgroundCommandService(
			createNodeBackgroundCommandHost({
				resolveShell: nodeShell,
				normalizeOutput: (value) => value.toUpperCase(),
			}),
		);
		try {
			const task = service.spawn({
				command: "process.stdout.write('background-ok')",
				cwd: process.cwd(),
				env: { ...process.env },
			});
			const result = await service.wait(task.id, { maxMs: 10_000 });

			expect(result.stillRunning).toBe(false);
			expect(result.snapshot).toMatchObject({ status: "completed", exitCode: 0 });
			expect(result.snapshot.tail).toBe("BACKGROUND-OK");
		} finally {
			await service.shutdown();
		}
	});
});
