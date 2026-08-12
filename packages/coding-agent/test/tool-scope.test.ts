import { describe, expect, it } from "vitest";
import {
	agentModePreferenceRank,
	resolveActiveToolNames,
	sortByAgentModePreference,
	type ToolActivationMetadata,
} from "../src/profiles/index.js";

/** 造一个仅含 scope 解析所需字段的最小工具桩。 */
function tool(name: string, scope_use?: string[], requires?: string[]): ToolActivationMetadata {
	return { name, scope_use, requires };
}

describe("resolveActiveToolNames", () => {
	it("激活 scope_use 含当前场景的工具", () => {
		const tools = [tool("read", ["conversation", "kb-processing"]), tool("kb_write_page", ["kb-processing"])];
		expect(resolveActiveToolNames("conversation", tools, new Set())).toEqual(["read"]);
		expect(resolveActiveToolNames("kb-processing", tools, new Set())).toEqual(["read", "kb_write_page"]);
	});

	it("fail-closed：缺省 scope_use 或空数组都不激活", () => {
		const tools = [tool("no_scope"), tool("empty_scope", [])];
		expect(resolveActiveToolNames("conversation", tools, new Set())).toEqual([]);
		expect(resolveActiveToolNames("cli", tools, new Set())).toEqual([]);
	});

	it("场景不在 scope_use 内则不激活", () => {
		const tools = [tool("im_send_attachment", ["im-claw"])];
		expect(resolveActiveToolNames("conversation", tools, new Set())).toEqual([]);
		expect(resolveActiveToolNames("im-claw", tools, new Set())).toEqual(["im_send_attachment"]);
	});

	it("requires 能力全满足才激活", () => {
		const tools = [
			tool("kb_filter", ["conversation"], ["knowledge"]),
			tool("task_output", ["conversation"], ["bg-tasks"]),
		];
		// 无能力 → 都不激活
		expect(resolveActiveToolNames("conversation", tools, new Set())).toEqual([]);
		// 仅 knowledge → 只激活 kb_filter
		expect(resolveActiveToolNames("conversation", tools, new Set(["knowledge"]))).toEqual(["kb_filter"]);
		// 两者齐 → 都激活
		expect(resolveActiveToolNames("conversation", tools, new Set(["knowledge", "bg-tasks"]))).toEqual([
			"kb_filter",
			"task_output",
		]);
	});

	it("agent mode 不排除工具，只把非本模式主推的排到末尾", () => {
		const tools = [{ ...tool("work-only", ["cli"]), agent_mode: ["work"] }, tool("shared", ["cli"])];
		expect(resolveActiveToolNames("cli", tools, new Set(), "work")).toEqual(["work-only", "shared"]);
		// 旧实现在此会返回 ["shared"]（硬闸排除）。
		expect(resolveActiveToolNames("cli", tools, new Set(), "coding")).toEqual(["shared", "work-only"]);
		expect(resolveActiveToolNames("cli", tools, new Set())).toEqual(["work-only", "shared"]);
	});

	it("未知 mode 只降权已声明工具，通用工具顺序不变", () => {
		const tools = [
			tool("a", ["cli"]),
			{ ...tool("b", ["cli"]), agent_mode: ["work"] },
			tool("c", ["cli"]),
			{ ...tool("d", ["cli"]), agent_mode: ["coding"] },
		];
		expect(resolveActiveToolNames("cli", tools, new Set(), "nonexistent-mode")).toEqual(["a", "c", "b", "d"]);
	});

	it("agent_mode 降权不会绕过 scope_use / requires 的 fail-closed 语义", () => {
		const tools = [
			{ ...tool("wrong_scope", ["im-claw"]), agent_mode: ["work"] },
			{ ...tool("missing_capability", ["cli"], ["knowledge"]), agent_mode: ["work"] },
		];
		expect(resolveActiveToolNames("cli", tools, new Set(), "work")).toEqual([]);
		expect(resolveActiveToolNames("cli", tools, new Set(), "coding")).toEqual([]);
	});

	it("同权重内顺序稳定可重复", () => {
		const tools = [
			{ ...tool("w1", ["cli"]), agent_mode: ["work"] },
			{ ...tool("c1", ["cli"]), agent_mode: ["coding"] },
			{ ...tool("w2", ["cli"]), agent_mode: ["work"] },
			{ ...tool("c2", ["cli"]), agent_mode: ["coding"] },
		];
		const first = resolveActiveToolNames("cli", tools, new Set(), "coding");
		expect(first).toEqual(["c1", "c2", "w1", "w2"]);
		expect(resolveActiveToolNames("cli", tools, new Set(), "coding")).toEqual(first);
	});
});

describe("sortByAgentModePreference", () => {
	const declared = (item: { modes?: string[] }) => item.modes;

	it("全部主推时返回与输入完全一致的顺序", () => {
		const items = [{ id: "a" }, { id: "b", modes: ["work"] }, { id: "c" }];
		expect(sortByAgentModePreference(items, "work", declared)).toEqual(items);
	});

	it("空 mode 视为无偏好，任何声明都不降权", () => {
		const items = [{ id: "a", modes: ["coding"] }, { id: "b" }, { id: "c", modes: ["work"] }];
		expect(sortByAgentModePreference(items, undefined, declared).map(({ id }) => id)).toEqual(["a", "b", "c"]);
	});

	it("空数组声明视为通用，不降权", () => {
		const items = [{ id: "a", modes: [] }, { id: "b" }];
		expect(sortByAgentModePreference(items, "coding", declared).map(({ id }) => id)).toEqual(["a", "b"]);
	});

	it("不丢条目：降权后集合与输入一致", () => {
		const items = [{ id: "a", modes: ["work"] }, { id: "b", modes: ["coding"] }, { id: "c" }];
		const sorted = sortByAgentModePreference(items, "coding", declared);
		expect(sorted).toHaveLength(items.length);
		expect([...sorted].sort((l, r) => l.id.localeCompare(r.id))).toEqual(
			items.slice().sort((l, r) => l.id.localeCompare(r.id)),
		);
		expect(sorted.map(({ id }) => id)).toEqual(["b", "c", "a"]);
	});
});

describe("agentModePreferenceRank", () => {
	it("通用与命中当前模式都是 0，其余是 1", () => {
		expect(agentModePreferenceRank(undefined, "work")).toBe(0);
		expect(agentModePreferenceRank([], "work")).toBe(0);
		expect(agentModePreferenceRank(["work"], "work")).toBe(0);
		expect(agentModePreferenceRank(["coding"], "work")).toBe(1);
		expect(agentModePreferenceRank(["coding"], undefined)).toBe(0);
	});
});
