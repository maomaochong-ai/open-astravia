import { describe, expect, it, vi } from "vitest";
import { createHostBashExecutor } from "../src/host/command-execution/index.js";

describe("host Bash executor", () => {
	it("preserves local process output, sanitization, streaming, and non-zero exit codes", async () => {
		const executor = createHostBashExecutor();
		const chunks: string[] = [];
		const command = createNodeCommand(
			"process.stdout.write('\\u001b[31mstdout\\r\\n');process.stderr.write('stderr');process.exitCode=7",
		);

		const result = await executor.execute(command, { onChunk: (chunk) => chunks.push(chunk) });

		expect(result.output).toContain("stdout\n");
		expect(result.output).toContain("stderr");
		expect(result.output).not.toContain("\u001b");
		expect(result.output).not.toContain("\r");
		expect(result.output).toBe(chunks.join(""));
		expect(result.exitCode).not.toBe(0);
		expect(result).toMatchObject({ cancelled: false, truncated: false });
	});

	it("returns the existing cancelled result shape for a pre-aborted local command", async () => {
		const executor = createHostBashExecutor();
		const controller = new AbortController();
		controller.abort();

		const result = await executor.execute(createNodeCommand("setTimeout(() => {}, 1000)"), {
			signal: controller.signal,
		});

		expect(result).toEqual({
			output: "",
			exitCode: undefined,
			cancelled: true,
			truncated: false,
		});
	});

	it("preserves custom operation streaming and cancellation semantics", async () => {
		const executor = createHostBashExecutor();
		const chunks: string[] = [];
		const operations = {
			exec: vi.fn(async (_command: string, _cwd: string, options: { onData: (data: Buffer) => void }) => {
				options.onData(Buffer.from("operation output"));
				return { exitCode: 3 };
			}),
		};

		const result = await executor.executeWithOperations("command", "C:/workspace", operations, {
			onChunk: (chunk) => chunks.push(chunk),
		});

		expect(operations.exec).toHaveBeenCalledWith(
			"command",
			"C:/workspace",
			expect.objectContaining({ onData: expect.any(Function) }),
		);
		expect(chunks).toEqual(["operation output"]);
		expect(result).toMatchObject({ output: "operation output", exitCode: 3, cancelled: false });
	});
});

function createNodeCommand(script: string): string {
	const executable = `"${process.execPath}"`;
	return process.platform === "win32" ? `& ${executable} -e "${script}"` : `${executable} -e "${script}"`;
}
