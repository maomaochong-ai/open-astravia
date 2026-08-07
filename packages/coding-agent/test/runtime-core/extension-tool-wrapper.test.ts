import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { wrapRuntimeToolsWithExtensions } from "../../src/adapters/runtime-core/extension-tool-wrapper.js";
import { CodingAgentPromptRequestAdapter } from "../../src/adapters/runtime-core/prompt-request-adapter.js";
import type { ExtensionRunner, ToolCallEvent, ToolResultEvent } from "../../src/extensions/index.js";

describe("Extension events", () => {
	it("transforms input before prompt resource expansion and can handle it without a turn", async () => {
		const order: string[] = [];
		const adapter = new CodingAgentPromptRequestAdapter({
			extensionEvents: {
				interceptInput: async (text, images, source) => {
					order.push(`input:${source}:${text}:${images?.length ?? 0}`);
					return text === "stop" ? { action: "handled" } : { action: "transform", text: "transformed", images };
				},
			},
			resolvePromptResource: (text) => {
				order.push(`resource:${text}`);
				return { text };
			},
		});
		const context = { sessionId: "session-1", queueing: false };

		const intercepted = await adapter.intercept(
			{ text: "original", promptRef: { kind: "skill", name: "fixture" } },
			context,
		);
		expect(intercepted.action).toBe("continue");
		if (intercepted.action !== "continue") throw new Error("Expected transformed prompt");
		await adapter.prepare(intercepted.request, context);
		await expect(adapter.intercept({ text: "stop" }, context)).resolves.toEqual({ action: "handled" });

		expect(order).toEqual(["input:rpc:original:0", "resource:transformed", "input:rpc:stop:0"]);
	});

	it("runs tool_call before execution and chains tool_result mutations", async () => {
		const order: string[] = [];
		const runner = {
			hasHandlers: (event: string) => event === "tool_call" || event === "tool_result",
			emitToolCall: vi.fn(async (event: ToolCallEvent) => {
				order.push(`call:${event.toolName}`);
				return undefined;
			}),
			emitToolResult: vi.fn(async (event: ToolResultEvent) => {
				order.push(`result:${event.toolName}:${event.isError}`);
				return {
					content: [{ type: "text" as const, text: "transformed result" }],
					details: { transformed: true },
					isError: false,
				};
			}),
		} satisfies Pick<ExtensionRunner, "hasHandlers" | "emitToolCall" | "emitToolResult">;
		const tool: RuntimeToolDefinition = {
			name: "fixture",
			label: "Fixture",
			description: "Fixture tool",
			inputSchema: { type: "object" },
			execute: async () => {
				order.push("execute");
				return { content: [{ type: "text", text: "original result" }], details: { transformed: false } };
			},
		};
		const wrapped = wrapRuntimeToolsWithExtensions(new Map([[tool.name, tool]]), runner).get(tool.name);
		if (!wrapped) throw new Error("Expected wrapped tool");

		const result = await wrapped.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { value: 1 },
			signal: new AbortController().signal,
		});

		expect(order).toEqual(["call:fixture", "execute", "result:fixture:false"]);
		expect(result).toEqual({
			content: [{ type: "text", text: "transformed result" }],
			details: { transformed: true },
		});
	});

	it("blocks tools before execution and still reports execution failures", async () => {
		const execute = vi.fn(async () => {
			throw new Error("tool failed");
		});
		const blockedRunner = {
			hasHandlers: () => true,
			emitToolCall: vi.fn(async () => ({ block: true, reason: "blocked by extension" })),
			emitToolResult: vi.fn(async () => undefined),
		} satisfies Pick<ExtensionRunner, "hasHandlers" | "emitToolCall" | "emitToolResult">;
		const failingTool: RuntimeToolDefinition = {
			name: "fixture",
			label: "Fixture",
			description: "Fixture tool",
			inputSchema: { type: "object" },
			execute,
		};
		const blocked = wrapRuntimeToolsWithExtensions(new Map([[failingTool.name, failingTool]]), blockedRunner).get(
			failingTool.name,
		);
		if (!blocked) throw new Error("Expected blocked tool");

		await expect(
			blocked.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "call-1",
				input: {},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("blocked by extension");
		expect(execute).not.toHaveBeenCalled();

		const failureRunner = {
			hasHandlers: (event: string) => event === "tool_result",
			emitToolCall: vi.fn(async () => undefined),
			emitToolResult: vi.fn(async () => undefined),
		} satisfies Pick<ExtensionRunner, "hasHandlers" | "emitToolCall" | "emitToolResult">;
		const failing = wrapRuntimeToolsWithExtensions(new Map([[failingTool.name, failingTool]]), failureRunner).get(
			failingTool.name,
		);
		if (!failing) throw new Error("Expected failing tool");
		await expect(
			failing.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "call-2",
				input: {},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("tool failed");
		expect(failureRunner.emitToolResult).toHaveBeenCalledWith(
			expect.objectContaining({
				toolCallId: "call-2",
				isError: true,
				content: [{ type: "text", text: "tool failed" }],
			}),
		);
	});
});
