import type { ContentBlock, ToolCallBlock } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { getAssistantFoldData } from "./messageBlockModel";

let counter = 0;

function tool(toolName: string, args: Record<string, unknown> = {}): ToolCallBlock {
	counter += 1;
	return { type: "tool_call", toolCallId: `t${counter}`, toolName, args, status: "success" };
}

function text(value: string): ContentBlock {
	counter += 1;
	return { type: "text", id: `x${counter}`, text: value };
}

const ARTIFACT = new Set(["plugin_chart"]);

describe("getAssistantFoldData 的答案区分界", () => {
	it("没有产物时，分界仍在最后一个过程块之后", () => {
		const blocks = [tool("read"), tool("grep"), text("结论如下")];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold?.processBlocks).toHaveLength(2);
		expect(fold?.answerBlocks).toHaveLength(1);
		expect(fold?.hiddenCount).toBe(2);
	});

	it("产物之后还有普通工具调用时，产物不再被折走", () => {
		const chart = tool("plugin_chart");
		const blocks = [tool("read"), text("点赞对比"), chart, text("明细榜单"), tool("write")];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold?.answerBlocks).toContain(chart);
		expect(fold?.processBlocks).not.toContain(chart);
	});

	it("产物上方引出它的结论文字一并留在答案区", () => {
		const chart = tool("plugin_chart");
		const blocks = [tool("read"), tool("grep"), text("结论：React 仍居首"), chart];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold?.processBlocks).toEqual([blocks[0], blocks[1]]);
		expect(fold?.answerBlocks).toEqual([blocks[2], chart]);
		expect(fold?.hiddenCount).toBe(2);
	});

	it("产物前有多段文字时全部留在答案区", () => {
		const chart = tool("plugin_chart");
		const blocks = [tool("read"), text("小标题"), text(""), text("引入文字"), chart, text("收尾")];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold?.processBlocks).toEqual([blocks[0]]);
		expect(fold?.answerBlocks).toEqual([blocks[1], blocks[2], blocks[3], chart, blocks[5]]);
	});

	it("产物之前没有文字时，答案区就从产物开始", () => {
		const chart = tool("plugin_chart");
		const blocks = [tool("read"), tool("grep"), chart, text("收尾")];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold?.answerBlocks).toEqual([chart, blocks[3]]);
	});

	it("分界不会被产物之后的工具调用往后推", () => {
		const chart = tool("plugin_chart");
		const write = tool("write");
		const blocks = [tool("read"), chart, text("说明"), write, text("收尾")];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold?.processBlocks).toEqual([blocks[0]]);
		expect(fold?.answerBlocks).toEqual([chart, blocks[2], write, blocks[4]]);
		expect(fold?.hiddenCount).toBe(1);
	});

	it("产物在最后一个过程块之后时，分界不会被产物往后推", () => {
		const chart = tool("plugin_chart");
		const blocks = [tool("read"), tool("grep"), text("说明"), chart, text("收尾")];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold?.processBlocks).toHaveLength(2);
		expect(fold?.answerBlocks).toHaveLength(3);
	});

	it("只有产物、没有收尾文字时依然折叠", () => {
		const chart = tool("plugin_chart");
		const blocks = [tool("read"), tool("grep"), chart];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold).not.toBeNull();
		expect(fold?.answerBlocks).toEqual([chart]);
		expect(fold?.outputBlocks).toHaveLength(0);
	});

	it("既无产物又无收尾文字时不折叠", () => {
		expect(getAssistantFoldData([tool("read"), tool("grep")], ARTIFACT)).toBeNull();
	});

	it("outputBlocks 只收文本，供复制与结论使用", () => {
		const chart = tool("plugin_chart");
		const blocks = [tool("read"), chart, text("说明"), text("  "), text("收尾")];
		const fold = getAssistantFoldData(blocks, ARTIFACT);
		expect(fold?.outputBlocks.map((block) => block.text)).toEqual(["说明", "收尾"]);
	});

	it("产物出现在首个工具调用之前时不显示折叠条", () => {
		const chart = tool("plugin_chart");
		const blocks = [
			text("这是一段足够长的主答案".repeat(20)),
			chart,
			tool("todo", { action: "update" }),
			text("完成"),
		];
		// 没有任何块落在答案区之前，折叠条会显示「展开 0 条」，直接不折。
		expect(getAssistantFoldData(blocks, ARTIFACT)).toBeNull();
	});
});
