import { describe, expect, it, vi } from "vitest";

const spawnCrossPlatformCommand = vi.fn();
vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [] } }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));
vi.mock("./command-launcher.js", () => ({ spawnCrossPlatformCommand }));
vi.mock("./plugin-catalog.js", () => ({
	listPlugins: () => [
		{
			id: "demo",
			enabled: true,
			permissions: ["agent.command.spawn"],
			grantedPermissions: ["agent.command.spawn"],
			declaredCommands: ["node"],
			grantedCommandNames: ["node"],
		},
	],
}));

const { spawnPluginCommand } = await import("./command-spawner.js");

describe("插件长驻进程与远程项目", () => {
	it("cwd 是远程项目时明确拒绝，而不是让 spawn 以一句像是本机缺命令的 ENOENT 失败", async () => {
		await expect(spawnPluginCommand("demo", "node", ["server.mjs"], { cwd: "ssh://host-1/srv/app" })).rejects.toThrow(
			/does not support remote projects: ssh:\/\/host-1\/srv\/app/,
		);
		expect(spawnCrossPlatformCommand).not.toHaveBeenCalled();
	});
});
