import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { type CommandToolExecutor, createNodeCodingToolEnvironment } from "../../src/coding/index.js";

describe("Node coding tool environment", () => {
	it("creates the Node registration set without owning scenario policy", () => {
		const environment = createNodeCodingToolEnvironment({
			cwd: "C:/workspace",
			commandExecutor: successfulCommandExecutor,
			executableResolver: { resolve: async () => undefined },
			editPathPolicy: allowAllPaths,
			writePathPolicy: allowAllPaths,
		});

		expect(environment.registrations.map(({ tool }) => tool.name)).toEqual([
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
		expect(environment.backgroundService).toBeUndefined();
		expect(() => environment.dispose()).not.toThrow();
	});

	it("requires an explicit command execution port", () => {
		expect(() =>
			createNodeCodingToolEnvironment({
				cwd: "C:/workspace",
				executableResolver: { resolve: async () => undefined },
				editPathPolicy: allowAllPaths,
				writePathPolicy: allowAllPaths,
			}),
		).toThrowError("requires foregroundCommand or commandExecutor");
	});
});

const successfulCommandExecutor: CommandToolExecutor = {
	execute: async (): Promise<RuntimeToolResult> => ({ content: [{ type: "text", text: "ok" }] }),
};

const allowAllPaths = { getRejectionReason: () => undefined };
