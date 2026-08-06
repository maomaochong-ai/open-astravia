import type { PluginCommandApi, PluginCommandRunResult } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { isInsideGitWorkTree } from "../src/git/tab-visibility";

function command(result: PluginCommandRunResult | Error): PluginCommandApi {
	return {
		run: async () => {
			if (result instanceof Error) throw result;
			return result;
		},
	};
}

describe("isInsideGitWorkTree", () => {
	it("is true inside a work tree", async () => {
		await expect(
			isInsideGitWorkTree(command({ stdout: "true\n", stderr: "", exitCode: 0 }), "/repo"),
		).resolves.toBe(true);
	});

	it("is false outside a repository (non-zero exit)", async () => {
		await expect(
			isInsideGitWorkTree(
				command({ stdout: "", stderr: "fatal: not a git repository", exitCode: 128 }),
				"/tmp/plain",
			),
		).resolves.toBe(false);
	});

	it("is false in a bare repository (no work tree to show changes for)", async () => {
		await expect(
			isInsideGitWorkTree(command({ stdout: "false\n", stderr: "", exitCode: 0 }), "/repo.git"),
		).resolves.toBe(false);
	});

	it("is false when the command is rejected/unavailable instead of throwing", async () => {
		await expect(isInsideGitWorkTree(command(new Error("command not allowed")), "/repo")).resolves.toBe(false);
	});
});
