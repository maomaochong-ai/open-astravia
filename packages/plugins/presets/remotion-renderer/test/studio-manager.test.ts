import type {
	PluginCommandSpawnHandle,
	PluginCommandSpawnOptions,
	PluginContext,
} from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStudioArgs, startRemotionStudio, stopAllRemotionStudios } from "../src/studio/studio-manager";

function projectContext(options: { allocatedPort?: number } = {}): {
	ctx: PluginContext;
	spawn: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
} {
	const cwd = "C:/video";
	const files: Record<string, string> = {
		[`${cwd}/package.json`]: "{}",
		[`${cwd}/src/index.ts`]: "",
		[`${cwd}/node_modules/@remotion/cli/package.json`]: JSON.stringify({ bin: "remotion-cli.js" }),
		[`${cwd}/node_modules/@remotion/cli/remotion-cli.js`]: "",
	};
	const stop = vi.fn(async () => undefined);
	const handle: PluginCommandSpawnHandle = {
		spawnId: "studio-1",
		pid: 42,
		port: options.allocatedPort,
		stop,
		status: async () => ({ running: true, pid: 42, port: options.allocatedPort, recentOutput: "" }),
		onExit: () => ({ dispose: () => undefined }),
	};
	const spawn = vi.fn(
		async (_file: string, _args?: string[], _options?: PluginCommandSpawnOptions): Promise<PluginCommandSpawnHandle> =>
			handle,
	);
	const ctx = {
		fs: {
			stat: async (path: string) =>
				path in files ? { size: files[path]?.length ?? 0, modifiedAt: 0, createdAt: 0 } : null,
			readFile: async (path: string) => ({ content: files[path] ?? "", encoding: "utf8" as const }),
		},
		command: { spawn },
		network: {
			request: async () => ({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: {},
				body: "<!doctype html>",
			}),
		},
	} as unknown as PluginContext;
	return { ctx, spawn, stop };
}

afterEach(async () => {
	await stopAllRemotionStudios();
});

describe("Remotion Studio manager", () => {
	it("builds Studio arguments without changing the project entry point", () => {
		expect(buildStudioArgs("C:/video/node_modules/@remotion/cli/remotion-cli.js", "src/index.ts")).toEqual([
			"C:/video/node_modules/@remotion/cli/remotion-cli.js",
			"studio",
			"src/index.ts",
			"--port",
			"{{PORT}}",
			"--no-open",
			"--ipv4",
		]);
	});

	it("deduplicates concurrent starts and stops the managed process", async () => {
		const { ctx, spawn, stop } = projectContext({ allocatedPort: 43100 });

		const [first, second] = await Promise.all([
			startRemotionStudio(ctx, "C:/video"),
			startRemotionStudio(ctx, "C:/video"),
		]);

		expect(first).toBe(second);
		expect(first.port).toBe(43100);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(spawn).toHaveBeenCalledWith(
			"node",
			[
				"C:/video/node_modules/@remotion/cli/remotion-cli.js",
				"studio",
				"src/index.ts",
				"--port",
				"{{PORT}}",
				"--no-open",
				"--ipv4",
			],
			{ cwd: "C:/video", allocatePort: true },
		);

		await stopAllRemotionStudios();
		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("stops a process when the host fails to allocate its port", async () => {
		const { ctx, stop } = projectContext();

		await expect(startRemotionStudio(ctx, "C:/video")).rejects.toThrow("did not allocate a port");
		expect(stop).toHaveBeenCalledTimes(1);
	});
});
