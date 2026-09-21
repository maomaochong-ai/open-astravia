import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { machineLocalPath, machineOf } from "../src/history/machine";
import { runHistoryCommand } from "../src/history/runner-host";

const REMOTE_DESIGN = "ssh://host-1/home/dev/codespace/system-specs.vetd";
const LOCAL_DESIGN = "/Users/me/codespace/system-specs.vetd";

interface RunCall {
	readonly args: readonly string[];
	readonly cwd: string | undefined;
}

/**
 * 假宿主：只记录每条命令去了哪台机器（cwd），并按 runner 的物化流程作答。
 * 分流本身由宿主负责，插件这边要保证的是「把设计稿的位置交出去」。
 */
function createContext(home: string): { ctx: PluginContext; calls: RunCall[] } {
	const calls: RunCall[] = [];
	const run = vi.fn(async (_file: string, args: readonly string[], options?: { cwd?: string }) => {
		calls.push({ args: [...args], cwd: options?.cwd });
		if (args[0] === "-p") return { stdout: home, stderr: "", exitCode: 0 };
		// 物化：先探测「已存在吗」，回答 yes 就不再分块写。
		if (args[0] === "-e") return { stdout: "yes", stderr: "", exitCode: 0 };
		return { stdout: '{"ok":true,"hasCommits":false}', stderr: "", exitCode: 0 };
	});
	return { ctx: { command: { run } } as unknown as PluginContext, calls };
}

describe("路径归属", () => {
	it("认出设计稿在哪台机器上", () => {
		expect(machineOf(REMOTE_DESIGN)).toBe("ssh://host-1");
		expect(machineOf("ssh://host-2/srv/app")).toBe("ssh://host-2");
		expect(machineOf(LOCAL_DESIGN)).toBe("local");
	});

	it("交给那台机器上的进程时去掉归属前缀", () => {
		expect(machineLocalPath(REMOTE_DESIGN)).toBe("/home/dev/codespace/system-specs.vetd");
		expect(machineLocalPath(LOCAL_DESIGN)).toBe(LOCAL_DESIGN);
	});
});

describe("历史命令跟着设计稿走", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("设计稿在远端时，每条 node 命令都带上它的位置——否则历史仓库会建到本机", async () => {
		// 回归：不带 cwd 时宿主一律在本机执行，`ssh://…` 被当成相对路径，
		// 于是在本机进程的工作目录下长出一棵 `ssh:` 目录，远端的设计稿一无所获。
		const { ctx, calls } = createContext("/home/dev");

		await runHistoryCommand(ctx, { cmd: "init", dir: REMOTE_DESIGN });

		expect(calls.length).toBeGreaterThan(0);
		for (const call of calls) expect(call.cwd).toBe(REMOTE_DESIGN);
	});

	it("交给 runner 的路径是那台机器上的绝对路径，不是内部标识", async () => {
		const { ctx, calls } = createContext("/home/dev");

		await runHistoryCommand(ctx, { cmd: "commit", dir: REMOTE_DESIGN, title: "x" });

		const request = calls.map((call) => call.args[1]).find((arg) => arg?.startsWith("{"));
		expect(JSON.parse(request ?? "{}")).toMatchObject({
			cmd: "commit",
			dir: "/home/dev/codespace/system-specs.vetd",
		});
		expect(request).not.toContain("ssh://");
	});

	it("本地项目原样不变", async () => {
		const { ctx, calls } = createContext("/Users/me");

		await runHistoryCommand(ctx, { cmd: "init", dir: LOCAL_DESIGN });

		for (const call of calls) expect(call.cwd).toBe(LOCAL_DESIGN);
		const request = calls.map((call) => call.args[1]).find((arg) => arg?.startsWith("{"));
		expect(JSON.parse(request ?? "{}")).toMatchObject({ dir: LOCAL_DESIGN });
	});

	it("没有设计稿位置就不执行任何命令——宁可报错也不要猜一个工作目录", async () => {
		const { ctx, calls } = createContext("/home/dev");

		await expect(runHistoryCommand(ctx, { cmd: "log" })).rejects.toThrow(/design directory/);
		expect(calls).toHaveLength(0);
	});
});
