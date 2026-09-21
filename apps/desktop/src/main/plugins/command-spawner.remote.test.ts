import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopbackSshConnection } from "@vetta/ssh-transport/testing";
import { describe, expect, it, vi } from "vitest";

const connection = createLoopbackSshConnection("build-01");
vi.mock("../ssh/ssh-runtime.js", () => ({ getSshConnection: () => connection }));
vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [] } }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));
vi.mock("./plugin-catalog.js", () => ({
	listPlugins: () => [
		{
			id: "demo",
			enabled: true,
			permissions: ["agent.command.spawn"],
			grantedPermissions: ["agent.command.spawn"],
			declaredCommands: ["sh", "npm"],
			grantedCommandNames: ["sh", "npm"],
		},
	],
}));

const { getPluginCommandSpawnStatus, spawnPluginCommand, stopPluginCommandSpawn } = await import(
	"./command-spawner.js"
);

function createRemoteProject(): { dir: string; uri: string } {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-spawn-")));
	return { dir, uri: `ssh://build-01${dir}` };
}

describe("插件的长驻进程与远程项目", () => {
	it("npm install 这类长跑命令在项目所在的机器上执行——本机跑它看不到任何项目文件", async () => {
		// 回归：守卫原先拒绝一切带远程 cwd 的 spawn，设计稿的依赖因此装不上。
		const project = createRemoteProject();
		writeFileSync(join(project.dir, "package.json"), '{"name":"demo"}');

		const started = await spawnPluginCommand("demo", "sh", ["-c", "cat package.json; echo done"], {
			cwd: project.uri,
		});

		await vi.waitFor(
			() => {
				const status = getPluginCommandSpawnStatus("demo", started.spawnId);
				expect(status.running).toBe(false);
				expect(status.exit?.exitCode).toBe(0);
				// 输出来自远端那份 package.json，证明命令确实在项目所在的机器上跑过。
				expect(status.recentOutput).toContain('"name":"demo"');
				expect(status.recentOutput).toContain("done");
			},
			{ timeout: 15_000 },
		);
	});

	it("要本机端口的进程仍然明确拒绝：搬到远端则界面连不上它", async () => {
		const project = createRemoteProject();

		await expect(
			spawnPluginCommand("demo", "npm", ["run", "dev", "--port", "{{PORT}}"], {
				cwd: project.uri,
				allocatePort: true,
			}),
		).rejects.toThrow(/needs a local port.*does not support remote projects|does not support remote projects/);
	});

	it("停止远端进程后状态转为已结束", async () => {
		const project = createRemoteProject();
		const started = await spawnPluginCommand("demo", "sh", ["-c", "echo up; sleep 60"], { cwd: project.uri });
		await vi.waitFor(
			() => expect(getPluginCommandSpawnStatus("demo", started.spawnId).recentOutput).toContain("up"),
			{ timeout: 15_000 },
		);

		await stopPluginCommandSpawn("demo", started.spawnId);

		expect(getPluginCommandSpawnStatus("demo", started.spawnId).running).toBe(false);
	});

	it("本地项目照旧，并且报得出真实进程号", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "vetta-local-spawn-")));
		const started = await spawnPluginCommand("demo", "sh", ["-c", "echo local"], { cwd: dir });

		expect(started.pid).toBeGreaterThan(0);
		await vi.waitFor(
			() => expect(getPluginCommandSpawnStatus("demo", started.spawnId).recentOutput).toContain("local"),
			{ timeout: 15_000 },
		);
	});
});
