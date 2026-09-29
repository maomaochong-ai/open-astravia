/**
 * `CONFIG_SET` 必须保留它不认识的配置字段。
 *
 * 这个处理器只能按字段白名单应用补丁，同时必须从中央事务入口提供的最新 DesktopConfig
 * 开始更新。`sshHosts` 与 `remoteControl` 曾因旧的整文件写回路径被漏掉；这个合同测试防止
 * IPC 再引入旁路写入或用字段白名单重建整份配置。
 *
 * 处理器接线在 `registerFsIpc` 内部，拿不到可注入的边界，故以源码断言守住这条结构约束
 * （与 agent-mode-ipc.test.ts 同一理由）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

function readConfigSetHandler(): string {
	const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fs.ts"), "utf8");
	const start = source.indexOf("ipcMain.handle(CHANNELS.CONFIG_SET");
	expect(start).toBeGreaterThan(0);
	const end = source.indexOf("ipcMain.handle(", start + 1);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
}

it("spreads the on-disk config so unlisted fields survive a settings save", () => {
	const handler = readConfigSetHandler();

	// 必须紧跟在开括号之后（注释除外）：晚于白名单摊开就会把补丁改回原值。
	expect(handler).toMatch(
		/updateDesktopConfig\(\s*\(current\): DesktopConfig => \(\{\s*(?:\/\/[^\n]*\n\s*)*\.\.\.current,/,
	);
});
