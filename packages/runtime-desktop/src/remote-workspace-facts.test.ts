import { describe, expect, it } from "vitest";
import { renderRemoteWorkspaceFacts } from "./remote-workspace-facts.js";

describe("远程项目的工作区说明", () => {
	const facts = renderRemoteWorkspaceFacts("/srv/app");

	it("点明项目不在本机，并给出远端路径", () => {
		expect(facts).toContain("/srv/app");
		expect(facts).toContain("not on the local computer");
	});

	it("明确 MCP 与插件看不到这个项目", () => {
		// 否则模型会用本机的 filesystem MCP 去读同名路径，读到的是另一台机器上的仓库，
		// 表现为「看起来成功了但改错了机器」。
		expect(facts).toContain("MCP servers, plugins");
		expect(facts).toMatch(/CANNOT see this project/);
	});

	it("说明技能脚本在本机、命令在远端，以及怎么让脚本跑起来", () => {
		// 技能正文让模型执行 `bash "$SKILL_DIR/scripts/run.sh"`，而 SKILL_DIR 是本机路径：
		// 不讲清楚的话，模型只会对着远端一个不存在的路径反复重试。
		expect(facts).toContain("SKILL_DIR");
		expect(facts).toMatch(/read it and write a copy/);
	});

	it("说明远端命令没有沙箱", () => {
		expect(facts).toContain("no sandbox");
	});

	it("告诉模型搜索工具在远端执行，以及远端没装时的退路", () => {
		// 远端缺 ripgrep 时工具会报错；模型得事先知道该换 grep/find，而不是反复重试。
		expect(facts).toContain("on the remote machine");
		expect(facts).toMatch(/fall back to `grep` or `find`/);
	});
});
