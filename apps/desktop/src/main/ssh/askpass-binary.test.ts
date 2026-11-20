import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAskpassWindowsBinary } from "./askpass-binary.js";

function createBinary(root: string, ...segments: string[]): string {
	const path = join(root, ...segments, "astravia-ssh-askpass.exe");
	mkdirSync(join(root, ...segments), { recursive: true });
	writeFileSync(path, "");
	return path;
}

describe("Windows askpass 二进制的定位", () => {
	it("打包后从应用资源目录取 askpass 目录下的 exe", () => {
		const resources = mkdtempSync(join(tmpdir(), "astravia-resources-"));
		const expected = createBinary(resources, "askpass", "windows-amd64");
		expect(resolveAskpassWindowsBinary({ resourcesPath: resources, cwd: "/nowhere" })).toBe(expected);
	});

	it("开发态回落到 apps/ssh-askpass 的交叉编译产物", () => {
		const repo = mkdtempSync(join(tmpdir(), "astravia-repo-"));
		const expected = createBinary(repo, "apps", "ssh-askpass", "dist", "windows-amd64");
		mkdirSync(join(repo, "apps", "desktop"), { recursive: true });
		expect(resolveAskpassWindowsBinary({ cwd: join(repo, "apps", "desktop") })).toBe(expected);
		expect(resolveAskpassWindowsBinary({ cwd: repo })).toBe(expected);
	});

	it("没有构建产物时返回 undefined，由调用方降级为不注入 askpass", () => {
		expect(resolveAskpassWindowsBinary({ cwd: mkdtempSync(join(tmpdir(), "astravia-empty-")) })).toBeUndefined();
	});
});
