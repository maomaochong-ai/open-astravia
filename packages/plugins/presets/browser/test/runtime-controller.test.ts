import type { PluginCommandApi, PluginCommandSpawnHandle, PluginCommandSpawnStatus } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { BrowserRuntimeController, type RuntimeStatus } from "../src/runtime/runtime-controller";

/**
 * 用窄 fake 顶掉宿主的命令能力：这是真实的外部边界，而轮询逻辑、状态迁移与失败分类
 * 都是我们自己的行为，必须能在没有 agent-browser 的机器上被测出来。
 */
interface SpawnScript {
	/** 每次 status() 依次返回的快照。 */
	frames: PluginCommandSpawnStatus[];
	/** spawn 本身失败（例如 npm 不在 PATH 上）。 */
	spawnError?: Error;
}

function frame(output: string, running: boolean, exitCode?: number): PluginCommandSpawnStatus {
	return {
		running,
		pid: 1,
		recentOutput: output,
		...(running ? {} : { exit: { exitCode: exitCode ?? 0, signal: null } }),
	};
}

function createCommand(options: {
	version?: { stdout: string; exitCode: number } | Error;
	spawns?: SpawnScript[];
}): { command: PluginCommandApi; spawnCalls: Array<{ file: string; args: string[] }> } {
	const spawnCalls: Array<{ file: string; args: string[] }> = [];
	let spawnIndex = 0;
	const command: PluginCommandApi = {
		run: async () => {
			const version = options.version;
			if (version instanceof Error) throw version;
			if (!version) throw new Error("Command failed to start: agent-browser (ENOENT)");
			return { stdout: version.stdout, stderr: "", exitCode: version.exitCode };
		},
		spawn: async (file, args) => {
			spawnCalls.push({ file, args: args ?? [] });
			const script = options.spawns?.[spawnIndex++];
			if (!script) throw new Error("unexpected spawn");
			if (script.spawnError) throw script.spawnError;
			let cursor = 0;
			const handle: PluginCommandSpawnHandle = {
				spawnId: "s1",
				pid: 1,
				stop: async () => undefined,
				status: async () => script.frames[Math.min(cursor++, script.frames.length - 1)],
				onExit: () => ({ dispose: () => undefined }),
			};
			return handle;
		},
	};
	return { command, spawnCalls };
}

/** 假时钟：安装轮询不该在测试里真的等待。 */
const noWait = async (): Promise<void> => undefined;

describe("BrowserRuntimeController.refresh", () => {
	it("agent-browser 不在 PATH 上（run 直接 reject）判定为未安装", async () => {
		const { command } = createCommand({});
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		expect((await controller.refresh()).phase).toBe("missing");
	});

	it("非零退出同样判定未安装，但保留诊断输出", async () => {
		const { command } = createCommand({ version: { stdout: "boom", exitCode: 1 } });
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		const status = await controller.refresh();
		expect(status.phase).toBe("missing");
		expect(status.output).toBe("boom");
	});

	it("退出码 0 且版本达标才判定就绪", async () => {
		const { command } = createCommand({ version: { stdout: "agent-browser 0.34.0\n", exitCode: 0 } });
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		const status = await controller.refresh();
		expect(status).toMatchObject({ phase: "ready", version: "0.34.0" });
	});

	it("跑得起来但版本过旧判定 outdated，而不是就绪", async () => {
		// 回归：机器上已有的 0.25.4 会被 wrapper 选中却在 exec 时立刻挂掉，
		// 旧实现在这里报「就绪」，用户看不到任何异常，会话里却一个浏览器工具都没有。
		const { command } = createCommand({ version: { stdout: "agent-browser 0.25.4\n", exitCode: 0 } });
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		const status = await controller.refresh();
		expect(status).toMatchObject({ phase: "outdated", version: "0.25.4" });
	});

	it("版本号读不出来时同样不判就绪", async () => {
		const { command } = createCommand({ version: { stdout: "", exitCode: 0 } });
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		expect((await controller.refresh()).phase).toBe("outdated");
	});
});

describe("BrowserRuntimeController.installRuntime", () => {
	it("安装成功后重新检测并进入就绪", async () => {
		const { command, spawnCalls } = createCommand({
			version: { stdout: "0.34.0", exitCode: 0 },
			spawns: [{ frames: [frame("downloading", true), frame("✓ Native binary ready", false, 0)] }],
		});
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		const status = await controller.installRuntime();
		expect(status.phase).toBe("ready");
		expect(spawnCalls[0].file).toBe("npm");
		expect(spawnCalls[0].args).toContain("-g");
	});

	it("锁定版本并关闭 engine-strict —— 宿主托管的是 node 22，上游 engines 要求 24", async () => {
		const { command, spawnCalls } = createCommand({
			version: { stdout: "0.34.0", exitCode: 0 },
			spawns: [{ frames: [frame("", false, 0)] }],
		});
		await new BrowserRuntimeController({ command, wait: noWait }).installRuntime();
		expect(spawnCalls[0].args.some((arg) => /^agent-browser@\d+\.\d+\.\d+$/.test(arg))).toBe(true);
		expect(spawnCalls[0].args).toContain("--engine-strict=false");
	});

	it("从安装输出识别系统 Chrome，避免白下几百 MB", async () => {
		const { command } = createCommand({
			version: { stdout: "0.34.0", exitCode: 0 },
			spawns: [{ frames: [frame("✓ System Chrome found: /Applications/Google Chrome.app", false, 0)] }],
		});
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		expect((await controller.installRuntime()).chromeDetected).toBe(true);
	});

	it("识别不出 Chrome 状态时保持 null，把选择交回用户而不是替他下载", async () => {
		const { command } = createCommand({
			version: { stdout: "0.34.0", exitCode: 0 },
			spawns: [{ frames: [frame("added 1 package", false, 0)] }],
		});
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		expect((await controller.installRuntime()).chromeDetected).toBeNull();
	});

	it("非零退出进入失败态，带上步骤与输出", async () => {
		const { command } = createCommand({
			spawns: [{ frames: [frame("npm ERR! network", false, 1)] }],
		});
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		const status = await controller.installRuntime();
		expect(status).toMatchObject({ phase: "failed", step: "runtime" });
		expect(status.output).toContain("npm ERR!");
	});

	it("spawn 起不来也是失败态，而不是无声挂起", async () => {
		const { command } = createCommand({ spawns: [{ frames: [], spawnError: new Error("ENOENT npm") }] });
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		const status = await controller.installRuntime();
		expect(status).toMatchObject({ phase: "failed", step: "runtime" });
		expect(status.message).toContain("ENOENT");
	});

	it("轮询期间把输出推给订阅者，安装进度才有得看", async () => {
		const { command } = createCommand({
			version: { stdout: "0.34.0", exitCode: 0 },
			spawns: [{ frames: [frame("10%", true), frame("60%", true), frame("done", false, 0)] }],
		});
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		const seen: RuntimeStatus[] = [];
		controller.subscribe((status) => seen.push({ ...status }));
		await controller.installRuntime();
		expect(seen.map((status) => status.output)).toContain("10%");
		expect(seen.map((status) => status.output)).toContain("60%");
	});
});

describe("BrowserRuntimeController.installBrowser", () => {
	it("走的是 agent-browser install 这一步", async () => {
		const { command, spawnCalls } = createCommand({
			version: { stdout: "0.34.0", exitCode: 0 },
			spawns: [{ frames: [frame("", false, 0)] }],
		});
		await new BrowserRuntimeController({ command, wait: noWait }).installBrowser();
		expect(spawnCalls[0]).toEqual({ file: "agent-browser", args: ["install"] });
	});
});

describe("BrowserRuntimeController.dispose", () => {
	it("卸载后不再向订阅者推状态，避免热重载后旧监听继续收事件", async () => {
		const { command } = createCommand({ version: { stdout: "0.34.0", exitCode: 0 } });
		const controller = new BrowserRuntimeController({ command, wait: noWait });
		let count = 0;
		controller.subscribe(() => count++);
		const before = count;
		await controller.dispose();
		await controller.refresh();
		expect(count).toBe(before);
	});
});
