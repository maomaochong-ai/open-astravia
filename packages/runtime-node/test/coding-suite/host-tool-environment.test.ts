import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { type CommandToolExecutor, createNodeHostCodingToolEnvironment } from "../../src/coding/index.js";

describe("Node host coding tool environment", () => {
	it("assembles the complete tool set from explicit host and product policy inputs", () => {
		const environment = createNodeHostCodingToolEnvironment({
			cwd: "C:/workspace",
			toolsDirectory: "C:/tools",
			resolveShell: () => ({ executable: "shell", args: ["-c"] }),
			commandExecutor: successfulCommandExecutor,
			resolveExecutable: async () => undefined,
			editPathPolicy: allowAllPaths,
			writePathPolicy: allowAllPaths,
		});

		expect(environment.registrations.map(({ tool }) => tool.name)).toEqual([
			"current_time",
			"read",
			"edit",
			"bash",
			"shell",
			"ls",
			"glob",
			"grep",
			"find",
			"dir_tree",
			"write",
		]);
		environment.dispose();
	});
});

const successfulCommandExecutor: CommandToolExecutor = {
	execute: async (): Promise<RuntimeToolResult> => ({ content: [{ type: "text", text: "ok" }] }),
};

const allowAllPaths = { getRejectionReason: () => undefined };
