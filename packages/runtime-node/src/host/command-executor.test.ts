import { describe, expect, it } from "vitest";
import { createNodeCommandExecutor } from "./command-executor.js";

describe("Node command executor", () => {
	it("captures output and exit status without shell interpolation", async () => {
		const result = await createNodeCommandExecutor().execute(
			process.execPath,
			["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"],
			process.cwd(),
		);

		expect(result).toEqual({ stdout: "out", stderr: "err", code: 7, killed: false });
	});

	it("marks a timed-out process as killed", async () => {
		const result = await createNodeCommandExecutor().execute(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			process.cwd(),
			{ timeout: 20 },
		);

		expect(result.killed).toBe(true);
	});
});
