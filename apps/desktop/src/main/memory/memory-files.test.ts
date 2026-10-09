import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readMemoryFiles, resolveMemoryFilePaths, resolveMemoryScopePath, writeMemoryFile } from "./memory-files.js";

const roots: string[] = [];

function createTempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "astravia-memory-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("记忆文件读写", () => {
	it("用户级路径由调用方注入，项目级固定落在会话 cwd 下", () => {
		const root = createTempDir();
		const paths = resolveMemoryFilePaths(join(root, "agent", "MEMORY.md"), join(root, "project"));

		expect(paths.user).toBe(join(root, "agent", "MEMORY.md"));
		expect(paths.project).toBe(join(root, "project", "MEMORY.md"));
	});

	it("作用域到路径的映射与 resolveMemoryFilePaths 一致", () => {
		const paths = { user: "/tmp/user/MEMORY.md", project: "/tmp/project/MEMORY.md" };

		expect(resolveMemoryScopePath(paths, "user")).toBe(paths.user);
		expect(resolveMemoryScopePath(paths, "project")).toBe(paths.project);
		// 没有项目目录时不允许把项目级作用域降级成相对路径，宁可直接报错。
		expect(() => resolveMemoryScopePath({ ...paths, project: null }, "project")).toThrow();
		expect(resolveMemoryScopePath({ ...paths, project: null }, "user")).toBe(paths.user);
	});

	it("文件尚未创建时返回空内容并标记 exists=false", () => {
		const root = createTempDir();
		const paths = resolveMemoryFilePaths(join(root, "agent", "MEMORY.md"), join(root, "project"));

		const snapshot = readMemoryFiles(paths);

		expect(snapshot.user).toEqual({ path: paths.user, content: "", exists: false });
		expect(snapshot.project).toEqual({ path: paths.project, content: "", exists: false });
	});

	it("没有项目目录时只返回用户级记忆，项目级为 null", () => {
		const root = createTempDir();
		const paths = resolveMemoryFilePaths(join(root, "agent", "MEMORY.md"), "");

		expect(paths.project).toBeNull();
		expect(readMemoryFiles(paths)).toEqual({ user: { path: paths.user, content: "", exists: false }, project: null });
	});

	it("写入后两个作用域各自读回自己的内容", () => {
		const root = createTempDir();
		const paths = resolveMemoryFilePaths(join(root, "agent", "MEMORY.md"), join(root, "project"));
		mkdirSync(dirname(paths.user), { recursive: true });
		mkdirSync(dirname(paths.project), { recursive: true });

		writeMemoryFile(resolveMemoryScopePath(paths, "user"), "用户级记忆");
		writeMemoryFile(resolveMemoryScopePath(paths, "project"), "项目级记忆");

		const snapshot = readMemoryFiles(paths);
		expect(snapshot.user).toEqual({ path: paths.user, content: "用户级记忆", exists: true });
		expect(snapshot.project).toEqual({ path: paths.project, content: "项目级记忆", exists: true });
	});

	it("覆盖写替换旧内容，且不留下临时文件", () => {
		const root = createTempDir();
		const path = join(root, "MEMORY.md");

		writeMemoryFile(path, "第一版");
		writeMemoryFile(path, "第二版\n第二行");

		expect(readMemoryFiles({ user: path, project: path }).user.content).toBe("第二版\n第二行");
		expect(existsSync(`${path}.tmp`)).toBe(false);
	});

	it("写入空字符串是合法的「清空」，而不是删除文件", () => {
		const root = createTempDir();
		const path = join(root, "MEMORY.md");
		writeMemoryFile(path, "内容");

		writeMemoryFile(path, "");

		expect(readMemoryFiles({ user: path, project: path }).user).toEqual({ path, content: "", exists: true });
	});

	it("父目录不存在时写入直接失败，交由界面提示保存错误", () => {
		const root = createTempDir();

		expect(() => writeMemoryFile(join(root, "missing", "MEMORY.md"), "内容")).toThrow();
	});
});
