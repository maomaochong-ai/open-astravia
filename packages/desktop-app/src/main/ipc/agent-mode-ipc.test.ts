/**
 * 改「新会话默认工作模式」只允许写配置 + 广播显示同步。
 *
 * 模式已不再排除任何插件贡献，所以按模式重建插件运行配置、或让 renderer 重载插件 bundle，
 * 都只是把一份完全相同的配置推给正在跑的会话，白白抖动活跃会话的插件运行时。
 * 该处理器接线在 `registerSessionIpc` 内部，拿不到可注入的边界，故以源码断言守住这条结构约束。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

function readGlobalAgentModeHandler(): string {
	const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "session.ts"), "utf8");
	const start = source.indexOf("ipcMain.handle(CHANNELS.SET_GLOBAL_AGENT_MODE");
	expect(start).toBeGreaterThan(0);
	const end = source.indexOf("ipcMain.handle(", start + 1);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
}

it("persists the default mode and broadcasts it for toggle display sync", () => {
	const handler = readGlobalAgentModeHandler();

	expect(handler).toContain("settings.defaultAgentMode = next");
	expect(handler).toContain("writeDesktopConfig(settings)");
	expect(handler).toContain("CHANNELS.AGENT_MODE_CHANGED");
});

it("never rebuilds plugin runtime config or reloads renderer plugins", () => {
	const handler = readGlobalAgentModeHandler();

	expect(handler).not.toMatch(/reconfigureAgentPlugins/);
	expect(handler).not.toMatch(/broadcastPluginsChanged/);
	expect(handler).not.toMatch(/setAgentMode/);
});
