import { describe, expect, it, vi } from "vitest";
import { createNodeHostBashExecutor } from "./bash-executor.js";

describe("Node Bash host", () => {
	it("preserves sanitized output, streaming and exit status", async () => {
		const chunks: string[] = [];
		const executor = createNodeHostBashExecutor({
			resolveShell: () => ({ executable: process.execPath, args: ["-e"] }),
		});

		const result = await executor.execute(
			"process.stdout.write('\\u001b[31mstdout\\r\\n');process.stderr.write('stderr');process.exitCode=7",
			{ onChunk: (chunk) => chunks.push(chunk) },
		);

		expect(result.output).toBe("stdout\nstderr");
		expect(result.output).toBe(chunks.join(""));
		expect(result).toMatchObject({ exitCode: 7, cancelled: false, truncated: false });
	});

	it("keeps the pre-aborted result contract", async () => {
		const controller = new AbortController();
		controller.abort();
		const executor = createNodeHostBashExecutor({
			resolveShell: () => ({ executable: process.execPath, args: ["-e"] }),
		});

		await expect(executor.execute("setTimeout(() => {}, 1000)", { signal: controller.signal })).resolves.toEqual({
			output: "",
			exitCode: undefined,
			cancelled: true,
			truncated: false,
		});
	});

	it("uses the operation boundary without spawning a second process", async () => {
		const executor = createNodeHostBashExecutor({
			resolveShell: () => ({ executable: process.execPath, args: ["-e"] }),
		});
		const operations = {
			exec: vi.fn(async (_command: string, _cwd: string, options: { onData: (data: Buffer) => void }) => {
				options.onData(Buffer.from("operation output"));
				return { exitCode: 3 };
			}),
		};

		await expect(executor.executeWithOperations("command", "C:/workspace", operations)).resolves.toMatchObject({
			output: "operation output",
			exitCode: 3,
			cancelled: false,
		});
		expect(operations.exec).toHaveBeenCalledOnce();
	});
});
