import { describe, expect, it } from "vitest";
import { resolveActiveToolNames, type ToolActivationMetadata } from "../src/profiles/index.js";

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

	it("agent mode 是与场景和 capability 正交的过滤轴", () => {
		const tools = [{ ...tool("work-only", ["cli"]), agent_mode: ["work"] }, tool("shared", ["cli"])];
		expect(resolveActiveToolNames("cli", tools, new Set(), "work")).toEqual(["work-only", "shared"]);
		expect(resolveActiveToolNames("cli", tools, new Set(), "coding")).toEqual(["shared"]);
		expect(resolveActiveToolNames("cli", tools, new Set())).toEqual(["work-only", "shared"]);
	});
});
