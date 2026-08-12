/**
 * 历史 runner 的集成测试：跑真实的 isomorphic-git、真实的临时目录。
 *
 * 这一层不能用单测替代——被测的正是「写出来的是不是一个能读回来的 git 仓库」，
 * 把 git 换成 mock 就什么都没验证。
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const RUNNER = join(__dirname, "..", "history-runner", "dist", "runner.mjs");

interface RunnerResult {
	ok: boolean;
	error?: string;
	hasCommits?: boolean;
	committed?: boolean;
	commit?: { sha: string; title: string; timestamp: number; files: string[]; restoredFrom?: string } | null;
	commits?: { sha: string; title: string; timestamp: number; files: string[]; restoredFrom?: string }[];
	content?: string | null;
}

async function run(request: Record<string, unknown>): Promise<RunnerResult> {
	const { stdout } = await execFileAsync(process.execPath, [RUNNER, JSON.stringify(request)]).catch(
		(error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }),
	);
	const line = stdout.trim().split("\n").pop() ?? "";
	return JSON.parse(line) as RunnerResult;
}

let dir = "";

beforeAll(async () => {
	if (!existsSync(RUNNER)) {
		throw new Error(`runner 未构建：先跑 bunx vite build --config vite.runner.config.ts（${RUNNER}）`);
	}
	dir = await mkdtemp(join(tmpdir(), "vetd-history-"));
	await mkdir(join(dir, "frames"), { recursive: true });
	await writeFile(join(dir, "frames", "login.tsx"), "export default function Login(){return null}\n");
	await writeFile(join(dir, "theme.css"), ":root{--color-primary:#000}\n");
});

afterAll(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("history runner", () => {
	it("初始化后仓库在 .history/，尚无提交", async () => {
		const result = await run({ cmd: "init", dir });
		expect(result.ok).toBe(true);
		expect(result.hasCommits).toBe(false);
		expect(existsSync(join(dir, ".history", "HEAD"))).toBe(true);
		// 不叫 .git：设计放进用户代码仓库时不能变成 embedded repository。
		expect(existsSync(join(dir, ".git"))).toBe(false);
	});

	it("首次提交收录源码并记下变更清单", async () => {
		const result = await run({ cmd: "commit", dir, title: "初始设计" });
		expect(result.ok).toBe(true);
		expect(result.committed).toBe(true);
		expect(result.commit?.title).toBe("初始设计");
		expect(result.commit?.files).toEqual(["frames/login.tsx", "theme.css"]);
	});

	it("没有改动就不产生空提交", async () => {
		const result = await run({ cmd: "commit", dir, title: "什么都没改" });
		expect(result.ok).toBe(true);
		expect(result.committed).toBe(false);
	});

	it("忽略清单里的东西不进历史", async () => {
		await mkdir(join(dir, "node_modules", "recharts"), { recursive: true });
		await writeFile(join(dir, "node_modules", "recharts", "index.js"), "module.exports={}\n");
		await mkdir(join(dir, ".snapshots"), { recursive: true });
		await writeFile(join(dir, ".snapshots", "login-1.png"), "not-a-real-png");
		await writeFile(join(dir, ".notes.json"), "[]");
		const result = await run({ cmd: "commit", dir, title: "只加了生成物" });
		expect(result.ok).toBe(true);
		expect(result.committed).toBe(false);
	});

	it("改一个文件只记这一个文件", async () => {
		await writeFile(join(dir, "frames", "login.tsx"), "export default function Login(){return <div/>}\n");
		const result = await run({ cmd: "commit", dir, title: "登录页换成深色" });
		expect(result.committed).toBe(true);
		expect(result.commit?.files).toEqual(["frames/login.tsx"]);
	});

	it("新增与删除都被记录", async () => {
		await writeFile(join(dir, "frames", "home.tsx"), "export default function Home(){return null}\n");
		await rm(join(dir, "theme.css"));
		const result = await run({ cmd: "commit", dir, title: "加首页、删主题" });
		expect(result.commit?.files.sort()).toEqual(["frames/home.tsx", "theme.css"]);
	});

	it("log 倒序返回版本，带标题与变更文件", async () => {
		const result = await run({ cmd: "log", dir });
		expect(result.ok).toBe(true);
		const titles = result.commits?.map((commit) => commit.title);
		expect(titles).toEqual(["加首页、删主题", "登录页换成深色", "初始设计"]);
		expect(result.commits?.[0]?.timestamp).toBeGreaterThan(0);
	});

	it("show 读得到旧版本里的文件内容", async () => {
		const log = await run({ cmd: "log", dir });
		const first = log.commits?.at(-1)?.sha ?? "";
		const result = await run({ cmd: "show", dir, sha: first, filepath: "theme.css" });
		expect(result.content).toBe(":root{--color-primary:#000}\n");
	});

	it("恢复把内容写回工作区，并作为新提交追加在历史顶部", async () => {
		const log = await run({ cmd: "log", dir });
		const initial = log.commits?.at(-1)?.sha ?? "";
		const result = await run({ cmd: "restore", dir, sha: initial, title: "恢复到：初始设计" });
		expect(result.ok).toBe(true);
		expect(result.committed).toBe(true);
		expect(result.commit?.restoredFrom).toBe(initial);
		// 内容回到了第一版：theme.css 回来了，后加的 home.tsx 没了。
		expect(await readFile(join(dir, "theme.css"), "utf8")).toBe(":root{--color-primary:#000}\n");
		expect(existsSync(join(dir, "frames", "home.tsx"))).toBe(false);
		// 历史只增不减：被恢复掉的那两版仍在列表里。
		const after = await run({ cmd: "log", dir });
		expect(after.commits?.map((commit) => commit.title)).toEqual([
			"恢复到：初始设计",
			"加首页、删主题",
			"登录页换成深色",
			"初始设计",
		]);
	});

	it("恢复不动 node_modules", async () => {
		expect(existsSync(join(dir, "node_modules", "recharts", "index.js"))).toBe(true);
	});

	it("打包再还原到另一份设计，历史完整跟过去", async () => {
		const pack = join(dir, ".history-pack.zip");
		const packed = await run({ cmd: "pack", dir, out: pack });
		expect(packed.ok).toBe(true);
		expect(existsSync(pack)).toBe(true);

		// 收包方那一侧：只有源码，没有 .history/。
		const target = await mkdtemp(join(tmpdir(), "vetd-history-import-"));
		await mkdir(join(target, "frames"), { recursive: true });
		await writeFile(join(target, "frames", "login.tsx"), "export default function Login(){return null}\n");
		const unpacked = await run({ cmd: "unpack", dir: target, from: pack });
		expect(unpacked.ok).toBe(true);

		const before = await run({ cmd: "log", dir });
		const after = await run({ cmd: "log", dir: target });
		expect(after.commits?.map((commit) => commit.sha)).toEqual(before.commits?.map((commit) => commit.sha));
		await rm(target, { recursive: true, force: true });
	});

	it("缩略图不进分享包——收包方自己会重新截", async () => {
		const log = await run({ cmd: "log", dir });
		const sha = log.commits?.[0]?.sha ?? "";
		await mkdir(join(dir, ".history", "thumbs", sha), { recursive: true });
		await writeFile(join(dir, ".history", "thumbs", sha, "index.jpg"), "x".repeat(2048));

		const withThumbs = join(dir, ".history-pack-2.zip");
		await run({ cmd: "pack", dir, out: withThumbs });
		const target = await mkdtemp(join(tmpdir(), "vetd-history-thumbs-"));
		await run({ cmd: "unpack", dir: target, from: withThumbs });
		expect(existsSync(join(target, ".history", "thumbs"))).toBe(false);
		expect(existsSync(join(target, ".history", "HEAD"))).toBe(true);
		await rm(target, { recursive: true, force: true });
	});

	it("目标已经有历史时不覆盖", async () => {
		const pack = join(dir, ".history-pack-3.zip");
		await run({ cmd: "pack", dir, out: pack });
		const result = await run({ cmd: "unpack", dir, from: pack });
		expect(result.files).toBe(0);
	});
});
