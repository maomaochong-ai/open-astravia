/**
 * RuntimeHost 每次发 prompt 前都会「修复工作目录」，拿到的是会话登记时的原始 cwd。
 * 远程项目下那是一整串 `ssh://<hostId>/<远端路径>`，交给 `fs.mkdir` 会被规范化成相对路径
 * `ssh:/<hostId>/…`，在进程当前目录下建出一棵空目录树——开发态就落在 `apps/desktop/` 里。
 *
 * 这条链路的失败会被上层 catch 掉，所以它不报错、不中断，只能靠测试守住。
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createDesktopRuntimeHostPlatformServices } from "./runtime-host-platform.js";

let workingDirectory: string;
let previousCwd: string;

beforeEach(() => {
	previousCwd = process.cwd();
	workingDirectory = mkdtempSync(join(tmpdir(), "vetta-host-platform-"));
	// 相对路径是相对进程 cwd 建的，所以必须真的切进去才能观察到症状。
	process.chdir(workingDirectory);
});

afterEach(() => {
	process.chdir(previousCwd);
	rmSync(workingDirectory, { recursive: true, force: true });
});

it("远程项目的 cwd 不会在本机建出目录", async () => {
	const { pathServices } = createDesktopRuntimeHostPlatformServices();

	await pathServices.ensureDirectory("ssh://27d6c013-53a7-467d-a910-1b49e7b24bc9/home/admin123/codespace");

	expect(readdirSync(workingDirectory)).toEqual([]);
});

it("本地项目的 cwd 照常建出来", async () => {
	const { pathServices } = createDesktopRuntimeHostPlatformServices();
	const target = join(workingDirectory, "projects", "demo");

	await pathServices.ensureDirectory(target);

	expect(readdirSync(join(workingDirectory, "projects"))).toEqual(["demo"]);
});
