import { describe, expect, it } from "vitest";
import { toAgentConfigurationOverrides } from "./agent-ability-overrides.js";

const ALL = { selectionMode: "all", skills: [], mcpServers: [], plugins: [] } as const;
const CUSTOM = { selectionMode: "custom", skills: ["a"], mcpServers: ["b"], plugins: ["c"] } as const;

describe("agent ability overrides", () => {
	it("inherits everything in `all` mode", () => {
		expect(toAgentConfigurationOverrides(ALL)).toEqual({});
	});

	it("keeps inheriting in `all` mode even with pinned plugins", () => {
		// 回归：曾经在这里把「全局已启用的插件」展开成显式数组再并上钉死项。那份数组会被
		// agent 侧按「有 agent 贡献的插件目录」校验，纯 UI 插件不在其中，于是建会话直接以
		// AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE 失败——选了插件智能体就发不出消息。
		expect(toAgentConfigurationOverrides(ALL, { plugins: ["vetta-ui-design"] })).toEqual({});
	});

	it("unions pinned plugins into an explicit selection", () => {
		expect(toAgentConfigurationOverrides(CUSTOM, { plugins: ["vetta-ui-design"] })).toEqual({
			skills: ["a"],
			mcpServers: ["b"],
			plugins: ["c", "vetta-ui-design"],
		});
	});

	it("does not duplicate a pinned plugin the user already selected", () => {
		expect(toAgentConfigurationOverrides(CUSTOM, { plugins: ["c"] }).plugins).toEqual(["c"]);
	});
});
