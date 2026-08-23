/**
 * plugin.json 的权限声明必须覆盖源码真正用到的宿主 API。
 *
 * 这条检查是拿真实故障换来的：`ctx.agent.registerHook` 缺权限时宿主是 **warn+noop**
 * ——注册静默失败，类型检查、单测、构建全都绿，回合结束自动提交就是不发生，磁盘上
 * 也没有任何错误痕迹。只有真的去用才会发现。
 */
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

/** 用到这个调用 → 必须声明这些权限。 */
const REQUIRED: { call: string; permissions: string[] }[] = [
	{ call: "agent.registerHook(", permissions: ["agent.hooks.register", "agent.hookHandler.execute"] },
	{ call: "agent.registerTool", permissions: ["agent.tools.register", "agent.toolHandler.execute"] },
	{ call: "command.run(", permissions: ["agent.command.run"] },
	{ call: "command.spawn(", permissions: ["agent.command.spawn"] },
	{ call: "ui.registerWorkspaceView(", permissions: ["ui.slot.workspace-view"] },
];

function sourceText(): string {
	const chunks: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (name.endsWith(".ts") || name.endsWith(".tsx")) chunks.push(readFileSync(path, "utf8"));
		}
	};
	walk(join(ROOT, "src"));
	return chunks.join("\n");
}

describe("plugin.json 权限声明", () => {
	const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")) as { permissions: string[] };
	const declared = new Set(manifest.permissions);
	const source = sourceText();

	for (const { call, permissions } of REQUIRED) {
		it(`用了 ${call} 就必须声明 ${permissions.join(" + ")}`, () => {
			if (!source.includes(call)) return;
			for (const permission of permissions) {
				expect(declared, `plugin.json 缺 "${permission}"——宿主会 warn+noop，功能静默失效`).toContain(permission);
			}
		});
	}
});
