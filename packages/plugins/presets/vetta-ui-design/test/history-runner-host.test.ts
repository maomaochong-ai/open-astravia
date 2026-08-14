/**
 * runner 物化链路：gzip → 分块写 → 解压落位 → 执行。
 *
 * 只把 `ctx.command` 换成真实的 node 子进程（宿主边界），引导脚本本身跑真的——
 * 那几段字符串脚本正是最容易悄悄写坏、而类型检查完全看不见的地方。
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

let home = "";
let runCount = 0;

/** 只实现被测模块用到的那一个方法；其余成员不该被碰到。 */
function fakeContext(): PluginContext {
	const command = {
		async run(file: string, args: string[] = [], options: { env?: Record<string, string> } = {}) {
			runCount++;
			// 真实宿主会解析到托管 node；测试里指向当前进程的 node 即可。
			if (args[0] === "-p" && args[1]?.includes("homedir")) {
				return { stdout: `${home}\n`, stderr: "", exitCode: 0 };
			}
			try {
				const { stdout, stderr } = await execFileAsync(process.execPath, args, {
					env: { ...process.env, ...options.env },
					maxBuffer: 8 * 1024 * 1024,
				});
				return { stdout, stderr, exitCode: 0 };
			} catch (error) {
				const failure = error as { stdout?: string; stderr?: string; code?: number };
				return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", exitCode: failure.code ?? 1 };
			}
		},
	};
	return { command } as unknown as PluginContext;
}

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "vetd-runner-home-"));
	runCount = 0;
	vi.resetModules();
});

afterEach(async () => {
	if (home) await rm(home, { recursive: true, force: true });
});

describe("runner 物化", () => {
	it("首次调用把 runner 解压落位，并且真的能执行", async () => {
		const { ensureRunner } = await import("../src/history/runner-host");
		const ctx = fakeContext();
		const runner = await ensureRunner(ctx);

		expect(runner.startsWith(`${home}/.vetta/plugin-data/vetta-ui-design/history-runner/`)).toBe(true);
		expect(existsSync(runner)).toBe(true);
		// 分块写入必须原样还原：截断或错序都会让下面这次执行报语法错误。
		const design = await mkdtemp(join(tmpdir(), "vetd-runner-design-"));
		await writeFile(join(design, "theme.css"), ":root{}\n");
		const { stdout } = await execFileAsync(process.execPath, [runner, JSON.stringify({ cmd: "init", dir: design })]);
		expect(JSON.parse(stdout.trim())).toMatchObject({ ok: true, initialized: true });
		await rm(design, { recursive: true, force: true });
	});

	it("已经物化过就不再重写，只探测一次", async () => {
		const { ensureRunner } = await import("../src/history/runner-host");
		const first = await ensureRunner(fakeContext());
		const callsAfterFirst = runCount;

		vi.resetModules();
		const reloaded = await import("../src/history/runner-host");
		const second = await reloaded.ensureRunner(fakeContext());

		expect(second).toBe(first);
		// 第二次只有 homedir + 存在性探测两次调用，没有任何分块写。
		expect(runCount - callsAfterFirst).toBe(2);
	});

	it("并发调用共用同一次物化", async () => {
		const { ensureRunner } = await import("../src/history/runner-host");
		const ctx = fakeContext();
		const [a, b, c] = await Promise.all([ensureRunner(ctx), ensureRunner(ctx), ensureRunner(ctx)]);
		expect(b).toBe(a);
		expect(c).toBe(a);
	});

	it("runner 失败时把错误抬成异常而不是静默返回", async () => {
		const { runHistoryCommand } = await import("../src/history/runner-host");
		await expect(runHistoryCommand(fakeContext(), { cmd: "nope", dir: home })).rejects.toThrow(/unknown command/);
	});
});
