import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@vetta/agent-core";
import { describe, expect, it } from "vitest";
import type {
	ExtensionToolPipelineHost,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "../src/extensions/index.js";
import { wrapToolWithExtensions } from "../src/extensions/index.js";

interface TestDetails {
	stage: string;
}

function createHost(options: {
	onToolCall?: (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined>;
	onToolResult?: (event: ToolResultEvent) => Promise<ToolResultEventResult | undefined>;
}): ExtensionToolPipelineHost {
	return {
		hasHandlers: (eventType) =>
			(eventType === "tool_call" && options.onToolCall !== undefined) ||
			(eventType === "tool_result" && options.onToolResult !== undefined),
		createContext: () => {
			throw new Error("Tool pipeline does not create an Extension Context");
		},
		emitToolCall: (event) => options.onToolCall?.(event) ?? Promise.resolve(undefined),
		emitToolResult: (event) => options.onToolResult?.(event) ?? Promise.resolve(undefined),
	};
}

function createTool(
	execute: AgentTool<typeof parameters, TestDetails>["execute"],
): AgentTool<typeof parameters, TestDetails> {
	return {
		name: "sample",
		label: "Sample",
		description: "Sample tool",
		parameters,
		execute,
	};
}

const parameters = Type.Object({ value: Type.String() });

describe("Extension Tool Pipeline", () => {
	it("按 tool_call、实际执行、tool_result 的顺序变换成功结果", async () => {
		const order: string[] = [];
		const host = createHost({
			onToolCall: async () => {
				order.push("tool_call");
				return undefined;
			},
			onToolResult: async (event) => {
				order.push(`tool_result:${event.isError}`);
				return {
					content: [{ type: "text", text: "transformed" }],
					details: { stage: "after" },
				};
			},
		});
		const tool = createTool(async () => {
			order.push("execute");
			return { content: [{ type: "text", text: "original" }], details: { stage: "before" } };
		});

		const result = await wrapToolWithExtensions(tool, host).execute("call-1", { value: "input" });

		expect(order).toEqual(["tool_call", "execute", "tool_result:false"]);
		expect(result).toEqual({
			content: [{ type: "text", text: "transformed" }],
			details: { stage: "after" },
		});
	});

	it("tool_call 阻断时不执行工具且不发送 tool_result", async () => {
		const order: string[] = [];
		const host = createHost({
			onToolCall: async () => {
				order.push("tool_call");
				return { block: true, reason: "denied" };
			},
			onToolResult: async () => {
				order.push("tool_result");
				return undefined;
			},
		});
		const tool = createTool(async () => {
			order.push("execute");
			return { content: [], details: { stage: "unreachable" } };
		});

		await expect(wrapToolWithExtensions(tool, host).execute("call-2", { value: "input" })).rejects.toThrow("denied");
		expect(order).toEqual(["tool_call"]);
	});

	it("工具执行失败时先发送错误 tool_result 再向上抛出原错误", async () => {
		const observedResults: ToolResultEvent[] = [];
		const failure = new Error("boom");
		const host = createHost({
			onToolResult: async (event) => {
				observedResults.push(event);
				return undefined;
			},
		});
		const tool = createTool(async () => {
			throw failure;
		});

		await expect(wrapToolWithExtensions(tool, host).execute("call-3", { value: "input" })).rejects.toBe(failure);
		expect(observedResults).toHaveLength(1);
		expect(observedResults[0]).toMatchObject({
			type: "tool_result",
			toolName: "sample",
			toolCallId: "call-3",
			isError: true,
			content: [{ type: "text", text: "boom" }],
		});
	});
});
