import type { ThinkingBlock, ToolCallBlock } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import {
	compactWorkActivityText,
	selectWorkGroupActivity,
	WORK_ACTIVITY_PREVIEW_MAX_CHARACTERS,
} from "./workActivityModel";

function tool(id: string, status: ToolCallBlock["status"]): ToolCallBlock {
	return { type: "tool_call", toolCallId: id, toolName: id, args: {}, status };
}

function thinking(text: string): ThinkingBlock {
	return { type: "thinking", id: `thinking-${text.length}`, text };
}

describe("selectWorkGroupActivity", () => {
	it("并行调用中优先返回最近的 pending 工具", () => {
		const activity = selectWorkGroupActivity([tool("still-running", "pending"), tool("settled-later", "success")]);

		expect(activity?.type).toBe("tool");
		expect(activity?.type === "tool" ? activity.block.toolCallId : null).toBe("still-running");
	});

	it("没有 pending 工具时按块顺序返回最新 thinking", () => {
		const activity = selectWorkGroupActivity([tool("read", "success"), thinking("  正在继续分析\n边界条件  ")]);

		expect(activity).toMatchObject({ type: "thinking", preview: "正在继续分析 边界条件" });
	});

	it("忽略空 thinking 并退回最近的工具", () => {
		const activity = selectWorkGroupActivity([tool("read", "success"), thinking(" \n ")]);

		expect(activity?.type).toBe("tool");
	});
});

describe("compactWorkActivityText", () => {
	it("保留长文本尾部并按 Unicode 字符截断", () => {
		const preview = compactWorkActivityText(`开头 ${"分析边界".repeat(30)}`);

		expect(preview.startsWith("…")).toBe(true);
		expect(preview.endsWith("分析边界")).toBe(true);
		expect(Array.from(preview)).toHaveLength(WORK_ACTIVITY_PREVIEW_MAX_CHARACTERS);
	});
});
