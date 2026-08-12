/**
 * 设计历史的 node 侧执行体（ADR-0069）。
 *
 * 为什么要有一个独立进程：isomorphic-git 读写的是 git 对象文件——无扩展名的二进制。
 * 插件的 `fs.readFile` 只对已知二进制扩展名返回 base64，其余按 utf8 解，object 文件
 * 走那条路必然损坏。所以历史读写全部留在 node 侧，渲染进程只发 JSON 指令。
 *
 * 协议：`node runner.mjs '<json>'` → stdout 一行 JSON。约定 `{ok:true,...}` /
 * `{ok:false,error}`，调用方不解析 stderr。
 */
import { createHash } from "node:crypto";
import fs, { type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import git from "isomorphic-git";

/** gitdir 不叫 `.git`：叫 `.git` 会让放进代码仓库的设计变成 embedded repository。 */
const GIT_DIR_NAME = ".history";

/**
 * 永远不进历史的顶层条目。
 *
 * `node_modules` 是性能前提而不是整洁问题：装两个库后设计目录会从 4 个文件涨到
 * 七千多个（ADR-0068 实测），每个回合遍历一遍会明显拖慢回合结束。所以下面的
 * 工作区遍历直接剪掉这些目录，而不是遍历完再过滤。
 */
const IGNORED_TOP_LEVEL = new Set([
	GIT_DIR_NAME,
	".git",
	".snapshots",
	".vetd-build",
	"node_modules",
	".notes.json",
	".DS_Store",
]);

const AUTHOR = { name: "Vetta", email: "design@vetta.local" };

/** 提交信息体里的机读尾注：变更文件清单在提交时就已知，存下来省得 log 时逐个算 diff。 */
const TRAILER_PREFIX = "vetta-history: ";

interface CommitTrailer {
	files: string[];
	/** 恢复提交指向的源版本，普通提交没有。 */
	restoredFrom?: string;
}

export interface HistoryCommit {
	sha: string;
	title: string;
	timestamp: number;
	files: string[];
	restoredFrom?: string;
}

function gitdirOf(dir: string): string {
	return join(dir, GIT_DIR_NAME);
}

/**
 * 工作区里参与版本控制的相对路径。自己走而不是交给 isomorphic-git 的 walker：
 * 剪枝必须发生在**下降之前**，否则 node_modules 已经被遍历完了。
 */
async function walkWorktree(dir: string): Promise<string[]> {
	const found: string[] = [];
	async function descend(relative: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(join(dir, relative), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const rel = relative ? `${relative}/${entry.name}` : entry.name;
			if (!relative && IGNORED_TOP_LEVEL.has(entry.name)) continue;
			if (entry.isDirectory()) {
				await descend(rel);
			} else if (entry.isFile()) {
				found.push(rel);
			}
		}
	}
	await descend("");
	return found.sort();
}

function buildMessage(title: string, trailer: CommitTrailer): string {
	const head = title.trim().split("\n")[0]?.slice(0, 200) || "更新设计";
	return `${head}\n\n${TRAILER_PREFIX}${JSON.stringify(trailer)}\n`;
}

function parseMessage(message: string): { title: string; trailer: CommitTrailer } {
	const lines = message.split("\n");
	const title = lines[0] ?? "";
	const trailerLine = lines.find((line) => line.startsWith(TRAILER_PREFIX));
	if (!trailerLine) return { title, trailer: { files: [] } };
	try {
		const parsed: unknown = JSON.parse(trailerLine.slice(TRAILER_PREFIX.length));
		if (typeof parsed !== "object" || parsed === null) return { title, trailer: { files: [] } };
		const record = parsed as { files?: unknown; restoredFrom?: unknown };
		return {
			title,
			trailer: {
				files: Array.isArray(record.files) ? record.files.filter((f): f is string => typeof f === "string") : [],
				restoredFrom: typeof record.restoredFrom === "string" ? record.restoredFrom : undefined,
			},
		};
	} catch {
		return { title, trailer: { files: [] } };
	}
}

async function hasCommits(dir: string): Promise<boolean> {
	try {
		await git.resolveRef({ fs, gitdir: gitdirOf(dir), ref: "HEAD" });
		return true;
	} catch {
		return false;
	}
}

/** 仓库不在就建，已存在就什么都不做。 */
async function ensureRepository(dir: string): Promise<void> {
	const gitdir = gitdirOf(dir);
	if (fs.existsSync(join(gitdir, "HEAD"))) return;
	await git.init({ fs, dir, gitdir, defaultBranch: "main" });
}

/**
 * 暂存并提交。没有任何实际变更时不产生空提交，返回 `{committed:false}`。
 *
 * 只把工作区遍历出来的文件（以及索引里已有的文件）交给 statusMatrix：它的
 * `filepaths` 是遍历根，不给的话会自己走整个目录树，node_modules 又回来了。
 */
async function commit(dir: string, title: string, restoredFrom?: string): Promise<HistoryCommit | null> {
	const gitdir = gitdirOf(dir);
	await ensureRepository(dir);
	const onDisk = await walkWorktree(dir);
	const tracked = await git.listFiles({ fs, gitdir }).catch(() => [] as string[]);
	const filepaths = [...new Set([...onDisk, ...tracked])];
	if (filepaths.length === 0) return null;

	const matrix = await git.statusMatrix({ fs, dir, gitdir, filepaths });
	const changed: string[] = [];
	for (const [filepath, head, workdir, stage] of matrix) {
		if (workdir === 0) {
			if (head === 0 && stage === 0) continue;
			await git.remove({ fs, dir, gitdir, filepath });
			changed.push(filepath);
			continue;
		}
		if (head !== workdir || stage !== workdir) {
			await git.add({ fs, dir, gitdir, filepath });
		}
		if (head !== workdir) changed.push(filepath);
	}
	if (changed.length === 0) return null;

	const message = buildMessage(title, { files: changed.sort(), restoredFrom });
	const timestamp = Date.now();
	const sha = await git.commit({
		fs,
		dir,
		gitdir,
		message,
		author: { ...AUTHOR, timestamp: Math.floor(timestamp / 1000) },
	});
	return { sha, title: parseMessage(message).title, timestamp, files: changed, restoredFrom };
}

async function log(dir: string, limit: number): Promise<HistoryCommit[]> {
	if (!(await hasCommits(dir))) return [];
	const entries = await git.log({ fs, gitdir: gitdirOf(dir), depth: limit });
	return entries.map((entry) => {
		const { title, trailer } = parseMessage(entry.commit.message);
		return {
			sha: entry.oid,
			title,
			timestamp: entry.commit.author.timestamp * 1000,
			files: trailer.files,
			restoredFrom: trailer.restoredFrom,
		};
	});
}

/**
 * 把某个版本的内容写回工作区，再落一个新提交——历史只增不减（ADR-0069）。
 * `noUpdateHead` 让 HEAD 留在分支尖端，于是「恢复」在历史里是一次前进而不是回退。
 */
async function restore(dir: string, sha: string, title: string): Promise<HistoryCommit | null> {
	const gitdir = gitdirOf(dir);
	await git.checkout({ fs, dir, gitdir, ref: sha, force: true, noUpdateHead: true });
	return commit(dir, title, sha);
}

/** 某个版本里一个文件的内容（预览、对比用）。 */
async function show(dir: string, sha: string, filepath: string): Promise<string | null> {
	try {
		const blob = await git.readBlob({ fs, gitdir: gitdirOf(dir), oid: sha, filepath });
		return Buffer.from(blob.blob).toString("utf8");
	} catch {
		return null;
	}
}

/** 内容哈希：给物化后的 runner 做版本标识，也用于调试。 */
export function contentDigest(text: string): string {
	return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

interface Request {
	cmd: string;
	dir: string;
	title?: string;
	sha?: string;
	filepath?: string;
	limit?: number;
}

async function dispatch(request: Request): Promise<unknown> {
	switch (request.cmd) {
		case "init": {
			await ensureRepository(request.dir);
			return { initialized: true, hasCommits: await hasCommits(request.dir) };
		}
		case "commit": {
			const result = await commit(request.dir, request.title ?? "更新设计");
			return { committed: result !== null, commit: result };
		}
		case "log":
			return { commits: await log(request.dir, request.limit ?? 100) };
		case "restore": {
			if (!request.sha) throw new Error("restore requires sha");
			const result = await restore(request.dir, request.sha, request.title ?? "恢复到历史版本");
			return { committed: result !== null, commit: result };
		}
		case "show": {
			if (!request.sha || !request.filepath) throw new Error("show requires sha and filepath");
			return { content: await show(request.dir, request.sha, request.filepath) };
		}
		default:
			throw new Error(`unknown command: ${request.cmd}`);
	}
}

async function main(): Promise<void> {
	const raw = process.argv[2];
	if (!raw) {
		process.stdout.write(`${JSON.stringify({ ok: false, error: "missing request" })}\n`);
		process.exitCode = 1;
		return;
	}
	try {
		const request = JSON.parse(raw) as Request;
		const payload = await dispatch(request);
		process.stdout.write(`${JSON.stringify({ ok: true, ...(payload as object) })}\n`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
		process.exitCode = 1;
	}
}

void main();
