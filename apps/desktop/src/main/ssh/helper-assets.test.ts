import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSshHelperBinary } from "./helper-assets.js";

function createBinary(root: string, ...segments: string[]): string {
	const path = join(root, ...segments, "vetta-ssh-helper");
	mkdirSync(join(root, ...segments), { recursive: true });
	writeFileSync(path, "");
	return path;
}

describe("远端 helper 二进制的定位", () => {
	const target = { os: "linux", arch: "arm64" } as const;

	it("打包后从应用资源目录取对应平台的那一份", () => {
		const resources = mkdtempSync(join(tmpdir(), "vetta-resources-"));
		const expected = createBinary(resources, "ssh-helper", "linux-arm64");
		createBinary(resources, "ssh-helper", "linux-amd64");
		expect(resolveSshHelperBinary(target, { resourcesPath: resources, cwd: "/nowhere" })).toBe(expected);
	});

	it("开发态回落到 apps/ssh-helper 的交叉编译产物", () => {
		const repo = mkdtempSync(join(tmpdir(), "vetta-repo-"));
		const expected = createBinary(repo, "apps", "ssh-helper", "dist", "linux-arm64");
		mkdirSync(join(repo, "apps", "desktop"), { recursive: true });
		expect(resolveSshHelperBinary(target, { cwd: join(repo, "apps", "desktop") })).toBe(expected);
		expect(resolveSshHelperBinary(target, { cwd: repo })).toBe(expected);
	});

	it("没有这个平台的构建时返回 undefined，由调用方降级", () => {
		expect(resolveSshHelperBinary(target, { cwd: mkdtempSync(join(tmpdir(), "vetta-empty-")) })).toBeUndefined();
	});
});
