/**
 * peek 的插件层跑真东西：真实临时设计目录、真实 runner、真实文件读写。
 *
 * 只有 `ctx.command` / `ctx.fs` 这两个宿主边界被换成本地实现，其余（peek.ts、
 * history-client、runner-host）全是生产代码。上一版只测了编排顺序（协作者全是 mock），
 * 于是「插件层调 runner 时到底通不通」根本没有被覆盖——点一下没反应就是那么来的。
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignSession } from "../src/vetd/design-session";

/**
 * 每个用例重新导入：runner-host 把「物化到哪」缓存在模块作用域，而这里每个用例
 * 用的是不同的临时 home。生产里 home 不变，这层重置只是测试隔离。
 */
function loadPeek(): Promise<typeof import("../src/history/peek")> {
	return import("../src/history/peek");
}

const execFileAsync = promisify(execFile);
const RUNNER = join(__dirname, "..", "history-runner", "dist", "runner.mjs");

let home = "";
let design = "";
let reloads = 0;

/** 宿主边界的本地实现：node 子进程 + 真实 fs。 */
function makeCtx(): PluginContext {
	return {
		command: {
			async run(_file: string, args: string[] = [], options: { env?: Record<string, string> } = {}) {
				try {
					const { stdout, stderr } = await execFileAsync(process.execPath, args, {
						env: { ...process.env, ...options.env },
						maxBuffer: 16 * 1024 * 1024,
					});
					return { stdout, stderr, exitCode: 0 };
				} catch (error) {
					const failure = error as { stdout?: string; stderr?: string; code?: number };
					return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", exitCode: failure.code ?? 1 };
				}
			},
		},
		fs: {
			async readFile(path: string) {
				return { content: await readFile(path, "utf8") };
			},
			async writeFile(path: string, content: string, encoding?: "utf8" | "base64") {
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, encoding === "base64" ? Buffer.from(content, "base64") : content);
			},
			async delete(path: string) {
				await unlink(path);
			},
		},
	} as unknown as PluginContext;
}

function makeSession(dirPath: string): DesignSession {
	return { dirPath, reload: async () => void reloads++ } as unknown as DesignSession;
}

async function runner(request: Record<string, unknown>): Promise<Record<string, unknown>> {
	const { stdout } = await execFileAsync(process.execPath, [RUNNER, JSON.stringify(request)]);
	return JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as Record<string, unknown>;
}

beforeEach(async () => {
	if (!existsSync(RUNNER)) throw new Error("runner 未构建");
	vi.resetModules();
	// runner-host 把 runner 物化到 `<home>/.vetta/...`，用临时 home 隔离真实目录。
	home = await mkdtemp(join(tmpdir(), "vetd-peek-home-"));
	process.env.HOME = home;
	reloads = 0;

	design = await mkdtemp(join(tmpdir(), "vetd-peek-design-"));
	await mkdir(join(design, "frames"), { recursive: true });
	await writeFile(join(design, "frames", "index.tsx"), "// v1\n");
	await runner({ cmd: "commit", dir: design, title: "初始状态" });
	await writeFile(join(design, "frames", "index.tsx"), "// v2\n");
	await runner({ cmd: "commit", dir: design, title: "改了首页" });
});

afterEach(async () => {
	for (const path of [home, design]) if (path) await rm(path, { recursive: true, force: true });
});

describe("peek 端到端", () => {
	it("查看旧版本：工作区变成那一版，标记落盘，画布被重载", async () => {
		const ctx = makeCtx();
		const first = (await runner({ cmd: "log", dir: design })) as { commits: { sha: string; title: string }[] };
		const target = first.commits[1] as { sha: string; title: string };

		const { enterPeek, readPeekState } = await loadPeek();
		const state = await enterPeek(ctx, makeSession(design), { sha: target.sha, title: target.title });

		expect(state).not.toBeNull();
		expect(await readFile(join(design, "frames", "index.tsx"), "utf8")).toBe("// v1\n");
		expect(await readPeekState(ctx, design)).toMatchObject({ sha: target.sha });
		expect(reloads).toBe(1);
	});

	it("退出查看：内容回到最新版，标记删掉，历史没有多出版本", async () => {
		const ctx = makeCtx();
		const before = (await runner({ cmd: "log", dir: design })) as { commits: { sha: string; title: string }[] };
		const target = before.commits[1] as { sha: string; title: string };

		const { enterPeek, exitPeek, readPeekState } = await loadPeek();
		await enterPeek(ctx, makeSession(design), { sha: target.sha, title: target.title });
		expect(await exitPeek(ctx, makeSession(design))).toBe(true);

		expect(await readFile(join(design, "frames", "index.tsx"), "utf8")).toBe("// v2\n");
		expect(await readPeekState(ctx, design)).toBeNull();
		const after = (await runner({ cmd: "log", dir: design })) as { commits: unknown[] };
		expect(after.commits).toHaveLength(before.commits.length);
	});

	it("查看前未提交的改动先被封存，不会被旧版本盖掉", async () => {
		const ctx = makeCtx();
		await writeFile(join(design, "frames", "index.tsx"), "// 还没提交的改动\n");
		const before = (await runner({ cmd: "log", dir: design })) as { commits: { sha: string; title: string }[] };
		const target = before.commits[1] as { sha: string; title: string };

		const { enterPeek, exitPeek } = await loadPeek();
		await enterPeek(ctx, makeSession(design), { sha: target.sha, title: target.title });
		await exitPeek(ctx, makeSession(design));

		// 退出后回到的是「封存了那笔改动」的版本，而不是查看前丢掉它。
		expect(await readFile(join(design, "frames", "index.tsx"), "utf8")).toBe("// 还没提交的改动\n");
		const after = (await runner({ cmd: "log", dir: design })) as { commits: { title: string }[] };
		expect(after.commits[0]?.title).toBe("查看历史前的状态");
	});
});
