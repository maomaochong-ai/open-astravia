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

	it("settles when a daemon keeps inherited output pipes open after the command shell exits", async () => {
		const host = createNodeForegroundCommandHost({ resolveShell: nodeShell });
		const startedAt = Date.now();
		const result = await host.operations.exec(createDaemonCommand(false), process.cwd(), {
			onData: () => {},
			timeout: 10,
		});

		expect(result.exitCode).toBe(0);
		expect(Date.now() - startedAt).toBeLessThan(2_500);
	});

	it("rejects at the deadline when a killed shell leaves daemon output pipes open", async () => {
		const host = createNodeForegroundCommandHost({ resolveShell: nodeShell });
		const startedAt = Date.now();

		await expect(
			host.operations.exec(createDaemonCommand(true), process.cwd(), {
				onData: () => {},
				timeout: 0.1,
			}),
		).rejects.toThrow("timeout:0.1");
		expect(Date.now() - startedAt).toBeLessThan(2_500);
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

	it("completes a background command when a daemon keeps inherited output pipes open", async () => {
		const service = createBackgroundCommandService(createNodeBackgroundCommandHost({ resolveShell: nodeShell }));
		try {
			const startedAt = Date.now();
			const task = service.spawn({
				command: createDaemonCommand(false),
				cwd: process.cwd(),
				env: { ...process.env },
			});
			const result = await service.wait(task.id, { maxMs: 2_500 });

			expect(result.stillRunning).toBe(false);
			expect(result.snapshot).toMatchObject({ status: "completed", exitCode: 0 });
			expect(Date.now() - startedAt).toBeLessThan(2_500);
		} finally {
			await service.shutdown();
		}
	});
});

function createDaemonCommand(keepParentAlive: boolean): string {
	const daemonScript = "setTimeout(() => process.exit(0), 5000)";
	return [
		"const { spawn } = require('node:child_process')",
		`const child = spawn(process.execPath, ['-e', ${JSON.stringify(daemonScript)}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] })`,
		"child.unref()",
		...(keepParentAlive ? ["setInterval(() => undefined, 1000)"] : []),
	].join(";");
}
