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
			process.platform === "win32" ? "shell" : "bash",
			"ls",
			"glob",
			"grep",
			"find",
			"dir_tree",
			"write",
		]);
		expect(environment.backgroundService).toBeUndefined();
		expect(
			environment
				.createSpecializedToolRegistrations({
					cwd: "C:/session-workspace",
					ocrExecutionGate: { run: (operation) => operation() },
				})
				.map(({ tool }) => tool.name),
		).toEqual(["doc_to_pdf", "html_to_pdf", "extract_text_from_pdf", "extract_text_from_img", "render_pdf_page"]);
		expect(() => environment.dispose()).not.toThrow();
	});

	it.each([
		["win32", "shell"],
		["linux", "bash"],
	] as const)("selects the supported command implementation for %s", (platform, commandToolName) => {
		const environment = createNodeCodingToolEnvironment({
			cwd: "C:/workspace",
			platform,
			commandExecutor: successfulCommandExecutor,
			executableResolver: { resolve: async () => undefined },
			editPathPolicy: allowAllPaths,
			writePathPolicy: allowAllPaths,
		});

		expect(
			environment.registrations.map(({ tool }) => tool.name).filter((name) => name === "bash" || name === "shell"),
		).toEqual([commandToolName]);
		environment.dispose();
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
