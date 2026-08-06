import type { ContentBlock, ToolCallBlock } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { groupBlocksForWork, isProgressGroupDone, type ProgressGroupSegment } from "./progressGroupModel";

let counter = 0;

function tool(
	toolName: string,
	args: Record<string, unknown> = {},
	status: ToolCallBlock["status"] = "success",
): ToolCallBlock {
	counter += 1;
	return { type: "tool_call", toolCallId: `t${counter}`, toolName, args, status };
}

function progress(args: { label?: string; summary?: string }): ToolCallBlock {
	return tool("progress", args);
}

function text(value: string): ContentBlock {
	counter += 1;
	return { type: "text", id: `x${counter}`, text: value };
}

function thinking(value: string): ContentBlock {
	counter += 1;
	return { type: "thinking", id: `k${counter}`, text: value };
}

function stages(blocks: ContentBlock[], streaming = false): ProgressGroupSegment[] {
	return groupBlocksForWork(blocks, new Set(), streaming).filter(
		(segment): segment is ProgressGroupSegment => segment.type === "progress_group",
	);
}

describe("groupBlocksForWork", () => {
	it("滑动窗口：下一次 progress 的 summary 关闭并改写上一阶段", () => {
		const result = stages([
			progress({ label: "探索项目配置" }),
			tool("read"),
			tool("grep"),
			progress({ summary: "查阅了 5 个配置文件", label: "定位调用点" }),
			tool("grep"),
			text("结论如下"),
		]);

		expect(result).toHaveLength(2);
		expect(result[0].summary).toBe("查阅了 5 个配置文件");
		expect(result[0].blocks).toHaveLength(2);
		expect(isProgressGroupDone(result[0])).toBe(true);
		expect(result[1].label).toBe("定位调用点");
		expect(result[1].summary).toBeUndefined();
		expect(result[1].blocks).toHaveLength(1);
	});

	it("正文文本隐式关闭最后一个阶段，标题退回 label", () => {
		const [stage] = stages([progress({ label: "整理数据" }), tool("read"), text("整理完成")]);
		expect(stage.closed).toBe(true);
		expect(stage.summary).toBeUndefined();
		expect(stage.label).toBe("整理数据");
	});

	it("流式期间末尾阶段保持进行中", () => {
		const [stage] = stages([progress({ label: "整理数据" }), tool("read")], true);
		expect(stage.closed).toBe(false);
		expect(isProgressGroupDone(stage)).toBe(false);
	});

	it("组内有 pending 调用时不算完成", () => {
		const [stage] = stages([progress({ label: "整理数据" }), tool("read", {}, "pending"), text("好了")]);
		expect(stage.closed).toBe(true);
		expect(isProgressGroupDone(stage)).toBe(false);
	});

	it("没有任何 progress 调用时退回启发式合组", () => {
		const segments = groupBlocksForWork([tool("read"), thinking("hmm"), tool("grep"), text("答案")], new Set());
		expect(segments.map((segment) => segment.type)).toEqual(["tool_group", "single"]);
		expect(stages([tool("read"), tool("grep")])).toHaveLength(0);
	});

	it("首次开组前的裸调用归入启发式兜底组，不混进后续阶段", () => {
		const segments = groupBlocksForWork(
			[tool("read"), tool("grep"), progress({ label: "整理数据" }), tool("read")],
			new Set(),
		);
		expect(segments[0].type).toBe("tool_group");
		const [stage] = stages([tool("read"), tool("grep"), progress({ label: "整理数据" }), tool("read")]);
		expect(stage.blocks).toHaveLength(1);
	});

	it("失败的工具调用留在阶段组内，不冒泡到组外", () => {
		const blocks = [
			progress({ label: "整理数据" }),
			tool("read"),
			tool("write", {}, "error"),
			tool("read"),
			progress({ summary: "整理了 2 份数据" }),
		];
		const segments = groupBlocksForWork(blocks, new Set());
		expect(segments.map((segment) => segment.type)).toEqual(["progress_group"]);
		const parts = stages(blocks);
		expect(parts).toHaveLength(1);
		expect(parts[0].blocks).toHaveLength(3);
		expect(parts[0].summary).toBe("整理了 2 份数据");
	});

	it("插件自定义 UI 工具永远组外单独渲染", () => {
		const segments = groupBlocksForWork(
			[progress({ label: "生成图表" }), tool("read"), tool("plugin_chart"), tool("read")],
			new Set(["plugin_chart"]),
		);
		expect(segments.map((segment) => segment.type)).toEqual(["progress_group", "single", "progress_group"]);
	});

	it("error 块冒泡到组外", () => {
		counter += 1;
		const errorBlock: ContentBlock = { type: "error", id: "e1", text: "boom", kind: "unknown" };
		const segments = groupBlocksForWork([progress({ label: "整理数据" }), tool("read"), errorBlock], new Set());
		expect(segments.map((segment) => segment.type)).toEqual(["progress_group", "single"]);
	});

	it("只报了一句就直接作答时，空阶段仍然保留标题", () => {
		const result = stages([progress({ label: "核对数据" }), text("已核对完毕")]);
		expect(result).toHaveLength(1);
		expect(result[0].label).toBe("核对数据");
		expect(result[0].blocks).toHaveLength(0);
	});

	it("空白文本分片不打断进行中的阶段", () => {
		const [stage] = stages([progress({ label: "整理数据" }), tool("read"), text("  "), tool("grep"), text("好了")]);
		expect(stage.blocks).toHaveLength(2);
	});

	it("thinking 进组但不产生独立分段", () => {
		const segments = groupBlocksForWork(
			[progress({ label: "整理数据" }), thinking("think"), tool("read"), text("好了")],
			new Set(),
		);
		expect(segments.map((segment) => segment.type)).toEqual(["progress_group", "single"]);
	});
});
