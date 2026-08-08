import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { inspectRemotionProject, resolveRemotionCliBin } from "../src/studio/project";

function memoryFs(files: Record<string, string>): PluginFsApi {
	return {
		stat: async (path) =>
			path in files
				? {
						size: files[path]?.length ?? 0,
						modifiedAt: 0,
						createdAt: 0,
					}
				: null,
		readFile: async (path) => ({ content: files[path] ?? "", encoding: "utf8" }),
	} as unknown as PluginFsApi;
}

describe("Remotion project inspection", () => {
	it("resolves the entry point and project-local CLI executable", async () => {
		const cwd = "C:/video";
		const fs = memoryFs({
			[`${cwd}/package.json`]: "{}",
			[`${cwd}/src/index.tsx`]: "",
			[`${cwd}/node_modules/@remotion/cli/package.json`]: JSON.stringify({
				bin: { remotion: "./dist/remotion-cli.js" },
			}),
			[`${cwd}/node_modules/@remotion/cli/dist/remotion-cli.js`]: "",
		});

		await expect(inspectRemotionProject(fs, cwd)).resolves.toEqual({
			kind: "ready",
			entryPoint: "src/index.tsx",
			cliPath: `${cwd}/node_modules/@remotion/cli/dist/remotion-cli.js`,
		});
	});

	it.each([
		{
			name: "missing package.json",
			files: {},
			reason: "package-json-missing",
		},
		{
			name: "missing entry point",
			files: { "C:/video/package.json": "{}" },
			reason: "entry-point-missing",
		},
		{
			name: "missing CLI dependency",
			files: { "C:/video/package.json": "{}", "C:/video/src/index.ts": "" },
			reason: "cli-package-missing",
		},
	])("classifies $name", async ({ files, reason }) => {
		await expect(inspectRemotionProject(memoryFs(files), "C:/video")).resolves.toEqual({
			kind: "not-ready",
			reason,
		});
	});

	it("rejects a CLI executable that escapes its package directory", () => {
		expect(resolveRemotionCliBin({ bin: { remotion: "../outside.js" } })).toBeNull();
		expect(resolveRemotionCliBin({ bin: "C:/outside.js" })).toBeNull();
	});
});
