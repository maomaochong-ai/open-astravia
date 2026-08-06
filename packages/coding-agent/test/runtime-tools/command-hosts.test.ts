import { createBackgroundCommandService } from "@vetta/runtime-tools/coding";
import { describe, expect, it } from "vitest";
import {
	createCodingAgentBackgroundCommandHost,
	createCodingAgentForegroundCommandHost,
} from "../../src/adapters/runtime-tools/index.js";

function localNodeCommand(script: string): string {
	const executable = `"${process.execPath}"`;
	return `${process.platform === "win32" ? "& " : ""}${executable} -e "${script}"`;
}

describe("Coding Agent command hosts", () => {
	it("executes a foreground command through the product shell host", async () => {
		const host = createCodingAgentForegroundCommandHost(process.cwd());
		let output = "";
		const result = await host.operations.exec(
			localNodeCommand("process.stdout.write('coding-agent-foreground-ok')"),
			process.cwd(),
			{
				onData: (data) => {
					output += data.toString("utf8");
				},
				timeout: 10,
			},
		);

		expect(result.exitCode).toBe(0);
		expect(output).toBe("coding-agent-foreground-ok");
	});

	it("executes and observes a background command through the product host", async () => {
		const service = createBackgroundCommandService(createCodingAgentBackgroundCommandHost());
		try {
			const task = service.spawn({
				command: localNodeCommand("process.stdout.write('coding-agent-background-ok')"),
				cwd: process.cwd(),
				env: { ...process.env },
			});
			const result = await service.wait(task.id, { maxMs: 10_000 });
			expect(result.stillRunning).toBe(false);
			expect(result.snapshot).toMatchObject({ status: "completed", exitCode: 0 });
			expect(result.snapshot.tail).toBe("coding-agent-background-ok");
		} finally {
			await service.shutdown();
		}
	});
});
