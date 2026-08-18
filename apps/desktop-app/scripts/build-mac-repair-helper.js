// 把 build/repair.applescript 编译成「修复已损坏.app」放进 DMG 暂存目录。
//
// 仅在 macOS host 上调用（osacompile 是 macOS 自带工具）。prepare-pack.js
// 在 process.platform === "darwin" 时才会调本脚本；其它平台直接跳过——
// 反正非 macOS 上也没法构建 .dmg。
//
// 用法：node build-mac-repair-helper.js <outputDir>
//   outputDir: 编译产物父目录，最终会得到 <outputDir>/修复已损坏.app

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dirname, "..");
const sourcePath = join(projectRoot, "build", "repair.applescript");

const outputDir = process.argv[2];
if (!outputDir) {
	throw new Error("build-mac-repair-helper: missing outputDir argument");
}
if (process.platform !== "darwin") {
	throw new Error(`build-mac-repair-helper: osacompile only runs on darwin (current: ${process.platform})`);
}
if (!existsSync(sourcePath)) {
	throw new Error(`build-mac-repair-helper: source not found: ${sourcePath}`);
}

const appPath = join(outputDir, "修复已损坏.app");
// osacompile 不会覆盖已存在的 .app bundle，会报错。提前清掉。
rmSync(appPath, { recursive: true, force: true });

console.log(`[build-mac-repair-helper] osacompile -> ${appPath}`);
execFileSync("/usr/bin/osacompile", ["-o", appPath, sourcePath], { stdio: "inherit" });
