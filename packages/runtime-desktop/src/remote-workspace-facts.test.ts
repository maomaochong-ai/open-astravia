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

	it("说明远端命令没有沙箱", () => {
		expect(facts).toContain("no sandbox");
	});

	it("告诉模型搜索要走命令行", () => {
		// 远程会话不注册 grep/glob，模型需要知道替代做法，否则会反复调用不存在的工具。
		expect(facts).toMatch(/grep|rg|find/);
	});
});
