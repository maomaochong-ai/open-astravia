import type { EventEmitter as EventEmitterType } from "node:events";
import type { PassThrough as PassThroughType } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnCrossPlatformCommand } from "./command-launcher.js";
import { runPluginCommand } from "./command-runner.js";
import { spawnPluginCommand } from "./command-spawner.js";

const pluginState = vi.hoisted(() => ({
	trustLevel: "local" as "community" | "local" | "official",
	grantedPermissions: ["agent.command.run", "agent.command.spawn"],
	gitBlocked: false,
}));

vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [] } }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: () => undefined, warn: () => undefined }),
}));
vi.mock("./command-launcher.js", async () => {
	const { EventEmitter } = await import("node:events");
	const { PassThrough } = await import("node:stream");
	return {
		spawnCrossPlatformCommand: vi.fn(() => {
			const child = new EventEmitter() as EventEmitterType & {
				pid: number;
				stdout: PassThroughType;
				stderr: PassThroughType;
				kill: ReturnType<typeof vi.fn>;
			};
			child.pid = 42;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			queueMicrotask(() => {
				child.emit("spawn");
				child.emit("exit", 0, null);
				child.emit("close", 0, null);
			});
			return child;
		}),
	};
});
vi.mock("../runtimes/manager.js", () => ({
	getRuntimeManager: () => ({ shouldBlockGitCommand: () => pluginState.gitBlocked }),
}));
vi.mock("./plugin-catalog.js", () => ({
	listPlugins: () => [
		{
			id: "command-test",
			enabled: true,
			trustLevel: pluginState.trustLevel,
			permissions: ["agent.command.run", "agent.command.spawn"],
			grantedPermissions: pluginState.grantedPermissions,
			declaredCommands: ["node", "git"],
			grantedCommandNames: ["node", "git"],
		},
	],
}));

describe("plugin command permissions", () => {
	beforeEach(() => {
		pluginState.trustLevel = "local";
		pluginState.grantedPermissions = ["agent.command.run", "agent.command.spawn"];
		pluginState.gitBlocked = false;
		vi.mocked(spawnCrossPlatformCommand).mockClear();
	});

	it.each(["local", "community"] as const)("allows %s plugins with explicit grants", async (trustLevel) => {
		pluginState.trustLevel = trustLevel;

		await expect(runPluginCommand("command-test", "node", [], undefined)).resolves.toMatchObject({ exitCode: 0 });
		await expect(spawnPluginCommand("command-test", "node", [], undefined)).resolves.toMatchObject({ pid: 42 });
	});

	it("still rejects a command when the permission was not granted", async () => {
		pluginState.grantedPermissions = [];

		await expect(runPluginCommand("command-test", "node", [], undefined)).rejects.toThrow(
			"Plugin permission denied: agent.command.run",
		);
	});

	it("reports git as missing without spawning the macOS install prompt", async () => {
		pluginState.gitBlocked = true;

		await expect(runPluginCommand("command-test", "git", ["--version"], undefined)).rejects.toThrow(
			"Command failed to start: git (ENOENT)",
		);
		expect(spawnCrossPlatformCommand).not.toHaveBeenCalled();
	});

	it("runs git normally when the host has it", async () => {
		await expect(runPluginCommand("command-test", "git", ["--version"], undefined)).resolves.toMatchObject({
			exitCode: 0,
		});
		expect(spawnCrossPlatformCommand).toHaveBeenCalledOnce();
	});
});
