import { Type } from "@sinclair/typebox";
import type { AssistantMessage, Tool } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { salvageTextToolCalls } from "../src/salvage-text-tool-calls.js";

const progressTool: Tool = {
	name: "progress",
	description: "narrate stages",
	parameters: Type.Object({
		description: Type.Optional(Type.String()),
		summary: Type.Optional(Type.String()),
		label: Type.Optional(Type.String()),
	}),
};

const todoTool: Tool = {
	name: "todo",
	description: "track steps",
	parameters: Type.Object({
		description: Type.Optional(Type.String()),
		action: Type.String(),
		items: Type.Optional(Type.Array(Type.String())),
		id: Type.Optional(Type.Number()),
		status: Type.Optional(Type.String()),
	}),
};

const writeTool: Tool = {
	name: "write",
	description: "write a file",
	parameters: Type.Object({ path: Type.String(), content: Type.String() }),
};

const TOOLS = [progressTool, todoTool, writeTool];
const ALLOWED = ["progress", "todo"];

function message(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse") {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "vetta-go",
		model: "gpt-test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	} satisfies AssistantMessage;
}

describe("salvageTextToolCalls", () => {
	it("还原被写成正文的 progress 调用，保留原有工具调用顺序", () => {
		// 线上样本：progress 参数走 content，真实调用只剩另一个工具
		const msg = message([
			{ type: "text", text: '{"summary":"确定了 Vercel 视觉方向","label":"应用 Vercel 设计体系"}\n' },
			{ type: "toolCall", id: "call_1", name: "write", arguments: { path: "a", content: "b" } },
		]);

		expect(salvageTextToolCalls(msg, TOOLS, ALLOWED)).toBe(true);
		expect(msg.content).toEqual([
			{
				type: "toolCall",
				id: expect.stringContaining("salvaged_progress"),
				name: "progress",
				arguments: { summary: "确定了 Vercel 视觉方向", label: "应用 Vercel 设计体系" },
			},
			{ type: "toolCall", id: "call_1", name: "write", arguments: { path: "a", content: "b" } },
		]);
	});

	it("还原 todo 调用并把 stopReason 提成 toolUse", () => {
		const msg = message([{ type: "text", text: '{"action":"update","id":7,"status":"done"}' }], "stop");

		expect(salvageTextToolCalls(msg, TOOLS, ALLOWED)).toBe(true);
		expect(msg.content).toHaveLength(1);
		expect(msg.content[0]).toMatchObject({ type: "toolCall", name: "todo" });
		expect(msg.stopReason).toBe("toolUse");
	});

	it("JSON 后面还有正文时，正文保留成独立 text block", () => {
		const msg = message([{ type: "text", text: '{"label":"应用 Vercel 设计体系"}\n行，我现在开始。' }]);

		expect(salvageTextToolCalls(msg, TOOLS, ALLOWED)).toBe(true);
		expect(msg.content).toHaveLength(2);
		expect(msg.content[1]).toMatchObject({ type: "text", text: "\n行，我现在开始。" });
	});

	it("不在白名单的工具不还原", () => {
		const msg = message([{ type: "text", text: '{"path":"a.ts","content":"x"}' }]);
		expect(salvageTextToolCalls(msg, TOOLS, ALLOWED)).toBe(false);
		expect(msg.content[0].type).toBe("text");
	});

	it("键在多个候选工具上都成立时不还原", () => {
		const msg = message([{ type: "text", text: '{"description":"随便说点什么"}' }]);
		expect(salvageTextToolCalls(msg, TOOLS, ALLOWED)).toBe(false);
	});

	it("含未知键的 JSON 不还原", () => {
		const msg = message([{ type: "text", text: '{"label":"x","unknown":1}' }]);
		expect(salvageTextToolCalls(msg, TOOLS, ALLOWED)).toBe(false);
	});

	it("普通正文与非对象 JSON 不受影响", () => {
		const msg = message([{ type: "text", text: "这是一段普通回答，里面提到了 label 和 summary。" }]);
		expect(salvageTextToolCalls(msg, TOOLS, ALLOWED)).toBe(false);

		const arrayMsg = message([{ type: "text", text: '[{"label":"x"}]' }]);
		expect(salvageTextToolCalls(arrayMsg, TOOLS, ALLOWED)).toBe(false);
	});

	it("正文以 ``` 包裹的代码块不还原", () => {
		const msg = message([{ type: "text", text: '```json\n{"label":"x"}\n```' }]);
		expect(salvageTextToolCalls(msg, TOOLS, ALLOWED)).toBe(false);
	});

	it("空对象与截断的 JSON 不还原", () => {
		expect(salvageTextToolCalls(message([{ type: "text", text: "{}" }]), TOOLS, ALLOWED)).toBe(false);
		expect(salvageTextToolCalls(message([{ type: "text", text: '{"label":"x"' }]), TOOLS, ALLOWED)).toBe(false);
	});

	it("未提供白名单或工具集时不做任何事", () => {
		const msg = message([{ type: "text", text: '{"label":"x"}' }]);
		expect(salvageTextToolCalls(msg, TOOLS, [])).toBe(false);
		expect(salvageTextToolCalls(msg, undefined, ALLOWED)).toBe(false);
	});
});
