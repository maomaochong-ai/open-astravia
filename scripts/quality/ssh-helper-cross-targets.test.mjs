import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 远端 helper 的目标平台列在两个地方，而且必须一致：
 *
 * - `apps/ssh-helper/Makefile` 的 `CROSS_TARGETS`：开发态 `make cross-build` 的产物，
 *   Desktop 会去 `dist/<os>-<arch>/` 找它们。
 * - `apps/desktop/scripts/prepare-pack.js` 的 `SSH_HELPER_TARGETS`：安装包里真正带上的那批。
 *
 * 打包脚本刻意不走 Makefile（与 im-gateway 一致，避免打包依赖 shell 语法），代价就是这份
 * 重复。两边漂了不会有任何报错：装了新平台的用户连上去，Desktop 找不到二进制，默默退回
 * `ssh exec`——后台任务从此断线就没，而没有人会把这件事联想到某次只改了一处列表。
 */
const repositoryRoot = join(import.meta.dirname, "../..");

function readMakefileTargets() {
	const makefile = readFileSync(join(repositoryRoot, "apps/ssh-helper/Makefile"), "utf8");
	// `CROSS_TARGETS := \` 之后每行一个目标，靠行尾反斜杠续行。
	const block = /^CROSS_TARGETS\s*:=\s*((?:.*\\\r?\n)*.*)$/m.exec(makefile)?.[1];
	if (!block) throw new Error("CROSS_TARGETS not found in apps/ssh-helper/Makefile");
	return block
		.split("\n")
		.map((line) => line.replace(/\\$/, "").trim())
		.filter((line) => line.length > 0);
}

function readPackagingTargets() {
	const script = readFileSync(join(repositoryRoot, "apps/desktop/scripts/prepare-pack.js"), "utf8");
	const block = /const SSH_HELPER_TARGETS = \[([\s\S]*?)\];/.exec(script)?.[1];
	if (!block) throw new Error("SSH_HELPER_TARGETS not found in apps/desktop/scripts/prepare-pack.js");
	return [...block.matchAll(/os:\s*"([^"]+)".*?arch:\s*"([^"]+)"/g)].map(([, os, arch]) => `${os}-${arch}`);
}

describe("远端 helper 的目标平台", () => {
	it("开发态构建与安装包携带的是同一批平台", () => {
		const fromMakefile = readMakefileTargets();
		expect(fromMakefile.length).toBeGreaterThan(0);
		expect([...fromMakefile].sort()).toEqual([...readPackagingTargets()].sort());
	});

	it("不包含 windows：进程托管用的 syscall 在那里不存在，根本编译不过", () => {
		// 也不必去补：整条远程项目链路都是 POSIX 形状的（`uname` 探测、`/bin/sh` 外壳、
		// coreutils 读写），远端用 cmd.exe / PowerShell 应答 SSH 时第一步探测就过不去，
		// 有没有 helper 都一样。
		expect(readMakefileTargets().filter((target) => target.startsWith("windows"))).toEqual([]);
		expect(readPackagingTargets().filter((target) => target.startsWith("windows"))).toEqual([]);
	});
});
