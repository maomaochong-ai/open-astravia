import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./build-dev-processes.mjs", import.meta.url), "utf8");

describe("Desktop development process build inputs", () => {
	it("invalidates the Main bundle when bundled platform runtime outputs change", () => {
		// main 的输入不逐包手写（曾漏掉 runtime-storage，改了 Schema 重启仍跑旧代码），
		// 而是把 packages/* 全量登记。只要 runtime-* 不在 external 名单里，它们的
		// package.json 与 dist 就都会参与 main 的输入哈希——这条守的是「别把它俩挪进
		// external 名单」，否则它们的产物变化不会再触发 main 重建。
		expect(source).toContain('readdir(join(repoRoot, "packages")');
		expect(source).toContain("mainExternalWorkspacePackages = new Set([");
		const externals = source.match(/mainExternalWorkspacePackages = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
		expect(externals).not.toContain("runtime-desktop");
		expect(externals).not.toContain("runtime-node");
		// 登记了还要真的接进 main 的 inputs，否则等于没写。
		expect(source).toContain("...mainBundledWorkspaceInputs");
	});

	it("ignores the workspace version bump when hashing inputs", () => {
		// bun.lock 与 apps/desktop/package.json 是四个任务共同的输入，整份内容参与哈希。
		// 版本号每个 release 都要升，不归一化的话每次启动开发壳都会全量重建四个任务，
		// main 一个人要十几分钟，整机被拖住。这条钉住归一化本身。
		expect(source).toContain("versionAgnosticInputs");
		expect(source).toContain('join(repoRoot, "bun.lock")');
		expect(source).toContain('join(desktopRoot, "package.json")');
	});

	it("caps build concurrency and lowers child priority off Windows", () => {
		// 四个 vite build 同时跑会把整机响应性吃满；dev 壳经常与正式壳一起开。
		expect(source).toContain("runWithConcurrency(pending, buildConcurrency, runTask)");
		expect(source).toContain('spawn("nice", ["-n", "10", "bun", ...args]');
	});
});
