import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopbackSshConnection } from "@vetta/ssh-transport/testing";
import { describe, expect, it, vi } from "vitest";

const connection = createLoopbackSshConnection("build-01");
vi.mock("../ssh/ssh-runtime.js", () => ({ getSshConnection: () => connection }));
// 端口转发经统一账本建立，而账本变化会广播给窗口：没有窗口的测试里也要有 BrowserWindow。
vi.mock("electron", () => ({
	webContents: { getAllWebContents: () => [] },
	BrowserWindow: { getAllWindows: () => [] },
}));
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

	it("要端口的进程：端口在远端分配，再转发回本机——插件拿到的始终是本机可连的那个", async () => {
		// 界面只能连本机端口，而服务器必须跑在项目所在的机器上。宿主把这两件事接起来，
		// 插件不必知道自己的进程在哪。
		const project = createRemoteProject();
		const forwards: { localPort: number; remotePort: number }[] = [];
		const cancelled: { localPort: number; remotePort: number }[] = [];
		connection.forwardPort = async (localPort: number, remotePort: number) => {
			forwards.push({ localPort, remotePort });
		};
		connection.cancelPortForward = async (localPort: number, remotePort: number) => {
			cancelled.push({ localPort, remotePort });
		};

		const started = await spawnPluginCommand("demo", "sh", ["-c", "echo port=$MY_PORT; sleep 30"], {
			cwd: project.uri,
			allocatePort: true,
			env: { MY_PORT: "{{PORT}}" },
		});

		expect(started.port).toBeGreaterThan(0);
		expect(forwards).toHaveLength(1);
		expect(forwards[0].localPort).toBe(started.port);
		// 进程拿到的是远端那个端口，与插件看到的本机端口不是同一个。
		expect(forwards[0].remotePort).not.toBe(started.port);
		await vi.waitFor(
			() =>
				expect(getPluginCommandSpawnStatus("demo", started.spawnId).recentOutput).toContain(
					`port=${forwards[0].remotePort}`,
				),
			{ timeout: 15_000 },
		);

		await stopPluginCommandSpawn("demo", started.spawnId);
		expect(cancelled).toEqual(forwards);
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
