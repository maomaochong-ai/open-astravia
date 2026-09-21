/**
 * `CONFIG_SET` 必须保留它不认识的配置字段。
 *
 * 这个处理器按字段白名单重建整个 DesktopConfig，而 writeDesktopConfig 是整文件覆盖。
 * 两者叠加的后果是：白名单里漏掉的字段会在用户每次保存设置时被从磁盘上抹掉。`sshHosts`
 * 与 `remoteControl` 曾经就这么丢过——它们晚于该处理器加入 DesktopConfig，又都是可选
 * 字段，类型检查不会报缺失，表现出来只是「SSH 主机有时候自己消失」。
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
	const next = handler.slice(handler.indexOf("const next: DesktopConfig = {"));

	// 必须紧跟在开括号之后（注释除外）：晚于白名单摊开就会把补丁改回原值。
	expect(next).toMatch(/const next: DesktopConfig = \{\s*(?:\/\/[^\n]*\n\s*)*\.\.\.current,/);
});
