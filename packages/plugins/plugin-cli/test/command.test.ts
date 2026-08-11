import { describe, expect, it, vi } from "vitest";
import { parsePluginAddCommand, runPluginAddCommand } from "../src/command.js";

describe("plugin add command", () => {
	it("parses npm add arguments", () => {
		expect(parsePluginAddCommand(["add", "@example/demo@^1", "--json"])).toEqual({
			type: "add",
			source: "@example/demo@^1",
			json: true,
		});
	});

	it("binds npm envelope identity to the Desktop install request", async () => {
		const cleanup = vi.fn().mockResolvedValue(undefined);
		const runAction = vi.fn().mockResolvedValue({
			operation: "install-from-path",
			plugin: { id: "demo", version: "1.2.0", activeVersion: "1.2.0" },
		});
		const output: string[] = [];
		const code = await runPluginAddCommand(
			{ type: "add", source: "@example/demo@1.2.0", json: false },
			{
				resolveNpmArchive: vi.fn().mockResolvedValue({
					archivePath: "C:/tmp/vetta-plugin.zip",
					cleanup,
					expectedSha256: "a".repeat(64),
					integrity: "sha512-test",
					requestedSpec: "@example/demo@1.2.0",
					packageManifest: {
						name: "@example/demo",
						version: "1.2.0",
						vetta: {
							schemaVersion: 1,
							type: "desktop-plugin",
							pluginId: "demo",
							archive: "release/vetta-plugin.zip",
						},
					},
				}),
				runAction,
				writeStdout: (value) => output.push(value),
				writeStderr: vi.fn(),
			},
		);

		expect(code).toBe(0);
		expect(runAction).toHaveBeenCalledWith("plugins.manage", {
			operation: "install-from-path",
			path: "C:/tmp/vetta-plugin.zip",
			enable: true,
			source: "npm",
			expectedSha256: "a".repeat(64),
			expectedId: "demo",
			expectedVersion: "1.2.0",
			npm: {
				packageName: "@example/demo",
				requestedSpec: "@example/demo@1.2.0",
				resolvedVersion: "1.2.0",
				integrity: "sha512-test",
			},
		});
		expect(output).toEqual(["Installed demo@1.2.0.\n"]);
		expect(cleanup).toHaveBeenCalledOnce();
	});
});
