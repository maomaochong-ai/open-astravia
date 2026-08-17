import { describe, expect, it } from "vitest";
import { createNodeSandboxCodingToolEnvironment } from "../../src/coding/index.js";

describe("Node sandbox coding tool environment", () => {
	it.each([
		{ platform: "linux" as const, command: "bash" },
		{ platform: "darwin" as const, command: "bash" },
		{ platform: "win32" as const, command: "shell" },
	])("creates the concrete sandbox tool set for $platform", ({ platform, command }) => {
		const environment = createNodeSandboxCodingToolEnvironment({
			cwd: "C:/workspace",
			platform,
			commandOperations: {
				async exec() {
					return { exitCode: 0 };
				},
			},
			editPathPolicy: allowAllPaths,
			writePathPolicy: allowAllPaths,
		});

		expect(environment).toBeDefined();
		expect([
			environment?.read.tool.name,
			environment?.write.tool.name,
			environment?.edit.tool.name,
			environment?.command.tool.name,
		]).toEqual(["read", "write", "edit", command]);
		expect(environment?.hostServices.platform).toBe(platform);
	});

	it("returns no tool set on unsupported platforms", () => {
		expect(
			createNodeSandboxCodingToolEnvironment({
				cwd: "/workspace",
				platform: "freebsd",
				commandOperations: {
					async exec() {
						return { exitCode: 0 };
					},
				},
				editPathPolicy: allowAllPaths,
				writePathPolicy: allowAllPaths,
			}),
		).toBeUndefined();
	});
});

const allowAllPaths = { getRejectionReason: () => undefined };
