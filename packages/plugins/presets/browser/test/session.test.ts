/**
 * session 派生。
 *
 * 关键不变量：同一个项目下的所有调用必须落到同一个 session，否则浏览器、登录态与钉住的
 * 标签页会在任务中途裂开——模型经常在子目录里执行命令，按 cwd 直接派生就会踩到这个坑。
 */
import { join, parse, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- shim 侧是无构建的 .mjs，没有类型声明。
import { buildSessionId, resolveWorkspaceRoot } from "../agent/skills/browser-use/scripts/lib/session.mjs";

const filesystemRoot = parse(process.cwd()).root;
const repository = join(filesystemRoot, "repo");
const gitAt = (root: string) => (path: string) => resolve(path) === resolve(root, ".git");

describe("resolveWorkspaceRoot", () => {
	it("从子目录向上找到 .git 所在的根", () => {
		expect(resolveWorkspaceRoot(join(repository, "packages", "app"), gitAt(repository))).toBe(repository);
	});

	it("不在仓库里时退回 cwd 自己", () => {
		const scratch = join(filesystemRoot, "tmp", "scratch");
		expect(resolveWorkspaceRoot(scratch, () => false)).toBe(scratch);
	});
});

describe("buildSessionId", () => {
	it("同一项目的不同子目录派生出同一个 session", () => {
		const exists = gitAt(repository);
		expect(buildSessionId(join(repository, "a", "b"), exists)).toBe(buildSessionId(repository, exists));
	});

	it("不同项目互不干扰", () => {
		expect(buildSessionId(join(filesystemRoot, "repo-a"), () => false)).not.toBe(
			buildSessionId(join(filesystemRoot, "repo-b"), () => false),
		);
	});

	it("带 Vetta 前缀，便于与用户自己在终端开的会话区分", () => {
		expect(buildSessionId(repository, () => false)).toMatch(/^vetta-[0-9a-f]{12}$/);
	});
});
