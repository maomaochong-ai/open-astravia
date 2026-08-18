import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPluginCommand } from "./command-runner.js";
import { spawnPluginCommand } from "./command-spawner.js";

const pluginState = vi.hoisted(() => ({ trustLevel: "local" as "community" | "local" | "official" }));

vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [] } }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: () => undefined, warn: () => undefined }),
}));
vi.mock("./plugin-catalog.js", () => ({
	listPlugins: () => [
		{
			id: "command-test",
			enabled: true,
			trustLevel: pluginState.trustLevel,
			permissions: ["agent.command.run", "agent.command.spawn"],
			grantedPermissions: ["agent.command.run", "agent.command.spawn"],
			declaredCommands: ["node"],
			grantedCommandNames: ["node"],
		},
	],
}));

describe("official-only plugin commands", () => {
	beforeEach(() => {
		pluginState.trustLevel = "local";
	});

	it.each(["local", "community"] as const)("rejects %s plugins before command execution", async (trustLevel) => {
		pluginState.trustLevel = trustLevel;

		await expect(runPluginCommand("command-test", "node", [], undefined)).rejects.toThrow(
			"Plugin command execution is restricted to official plugins",
		);
	});

	it("rejects long-lived commands from non-official plugins", async () => {
		await expect(spawnPluginCommand("command-test", "node", [], undefined)).rejects.toThrow(
			"Plugin command execution is restricted to official plugins",
		);
	});
});
