import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ipcMain } from "electron";
import { getAppLogger } from "../logger.js";
import { getRuntimeManager } from "../runtimes/manager.js";

const log = getAppLogger("project-clone");

export const PROJECT_CLONE_CHANNELS = {
	CLONE: "astravia:project:clone",
	CANCEL: "astravia:project:clone-cancel",
} as const;

export type ProjectCloneErrorCode =
	| "git-unavailable"
	| "invalid-url"
	| "invalid-target"
	| "target-exists"
	| "clone-failed"
	| "cancelled";

export interface ProjectCloneInput {
	/** 渲染进程生成，用来在取消时找到对应的 git 进程。 */
	requestId: string;
	url: string;
	/** 克隆出的仓库目录会建在这个目录下。 */
	parentDir: string;
}

export type ProjectCloneResult =
	| { path: string; name: string }
	| { error: { code: ProjectCloneErrorCode; message: string } };

const URL_SCHEME_RE = /^(https?|ssh|git|file):\/\/\S+$/i;
// scp 风格：git@github.com:owner/repo.git
const SCP_LIKE_RE = /^[\w.-]+@[\w.-]+:\S+$/;

/** 只放行 git 认得的几种地址形态；以 `-` 开头的会被 git 当成选项，必须挡掉。 */
export function isCloneableRepoUrl(url: string): boolean {
	if (!url || url.startsWith("-")) return false;
	return URL_SCHEME_RE.test(url) || SCP_LIKE_RE.test(url) || isAbsolute(url);
}

/** 从仓库地址取默认目录名：最后一段去掉 `.git`；取不出合法名字返回 null。 */
export function deriveRepoDirName(url: string): string | null {
	const trimmed = url.trim().replace(/[/\\]+$/, "");
	const last = trimmed.split(/[/\\:]/).pop() ?? "";
	const name = last.replace(/\.git$/i, "");
	if (!name || name === "." || name === ".." || /[/\\:*?"<>|]/.test(name)) return null;
	return name;
}

const running = new Map<string, ChildProcess>();
const cancelled = new Set<string>();

function fail(code: ProjectCloneErrorCode, message: string): ProjectCloneResult {
	return { error: { code, message } };
}

/** git 把进度和报错都写在 stderr；取最后几行足够说明失败原因。 */
function tailMessage(stderr: string): string {
	const lines = stderr
		.split(/[\r\n]+/)
		.map((line) => line.trim())
		.filter((line) => line && !/^(Cloning into|remote:|Receiving|Resolving|Updating)/.test(line));
	return lines.slice(-3).join("\n") || stderr.trim().slice(-300);
}

export async function cloneProject(input: ProjectCloneInput): Promise<ProjectCloneResult> {
	const url = input.url.trim();
	if (!isCloneableRepoUrl(url)) return fail("invalid-url", "仓库地址不合法");
	const name = deriveRepoDirName(url);
	if (!name) return fail("invalid-url", "无法从仓库地址推断目录名");
	if (!input.parentDir || !isAbsolute(input.parentDir) || !existsSync(input.parentDir)) {
		return fail("invalid-target", "存放目录不存在");
	}
	const target = join(input.parentDir, name);
	if (existsSync(target)) return fail("target-exists", `目录已存在：${target}`);
	// macOS 上没装命令行工具时执行 git 会弹系统安装框，先挡掉。
	if (getRuntimeManager().shouldBlockGitCommand()) return fail("git-unavailable", "未检测到 Git");

	return new Promise<ProjectCloneResult>((resolve) => {
		let stderr = "";
		const child = spawn("git", ["clone", "--progress", "--", url, target], {
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
			// 不让 git 在后台等密码：拿不到凭据就直接失败，由面板把原因展示出来。
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
		});
		running.set(input.requestId, child);
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf-8")).slice(-4000);
		});
		const finish = (result: ProjectCloneResult): void => {
			running.delete(input.requestId);
			cancelled.delete(input.requestId);
			resolve(result);
		};
		child.on("error", (error: NodeJS.ErrnoException) => {
			finish(
				error.code === "ENOENT" ? fail("git-unavailable", "未检测到 Git") : fail("clone-failed", error.message),
			);
		});
		child.on("close", (code) => {
			if (cancelled.has(input.requestId)) {
				// 被取消时 git 可能留下半成品目录。
				void rm(target, { recursive: true, force: true }).finally(() => finish(fail("cancelled", "已取消")));
				return;
			}
			if (code === 0) {
				log.info(`cloned ${url} → ${target}`);
				finish({ path: target, name });
				return;
			}
			log.warn(`git clone failed (exit ${code}) for ${url}`);
			void rm(target, { recursive: true, force: true }).finally(() =>
				finish(fail("clone-failed", tailMessage(stderr) || `git 退出码 ${code}`)),
			);
		});
	});
}

export function cancelClone(requestId: string): void {
	const child = running.get(requestId);
	if (!child) return;
	cancelled.add(requestId);
	child.kill();
}

export function registerProjectCloneIpc(): () => void {
	ipcMain.handle(PROJECT_CLONE_CHANNELS.CLONE, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		if (typeof raw.requestId !== "string" || typeof raw.url !== "string" || typeof raw.parentDir !== "string") {
			return fail("invalid-url", "参数不合法");
		}
		return cloneProject({ requestId: raw.requestId, url: raw.url, parentDir: raw.parentDir });
	});
	ipcMain.handle(PROJECT_CLONE_CHANNELS.CANCEL, (_event, requestId: unknown) => {
		if (typeof requestId === "string") cancelClone(requestId);
	});
	return () => {
		ipcMain.removeHandler(PROJECT_CLONE_CHANNELS.CLONE);
		ipcMain.removeHandler(PROJECT_CLONE_CHANNELS.CANCEL);
	};
}
