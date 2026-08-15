import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { type AssistantMessage, type Context, createPromptCacheDiagnostics } from "../src/index.js";

describe("prompt cache diagnostics", () => {
	it("ignores local bookkeeping and the current request tail", () => {
		const first = createPromptCacheDiagnostics(context());
		const changed = context();
		const assistant = changed.messages[1] as AssistantMessage;
		assistant.timestamp = 999;
		assistant.usage = { ...assistant.usage, input: 999 };
		changed.messages[2] = { ...changed.messages[2]!, details: { local: "changed" }, timestamp: 888 };
		changed.messages[3] = { role: "user", content: "a different current request", timestamp: 777 };

		expect(createPromptCacheDiagnostics(changed)).toEqual(first);
	});

	it("isolates stable system, volatile system, tools, and history changes", () => {
		const base = context();
		const original = createPromptCacheDiagnostics(base);
		const volatileChanged = createPromptCacheDiagnostics({
			...base,
			systemPrompt: "Stable prefix\n\nnew volatile tail",
		});
		const stableChanged = createPromptCacheDiagnostics({
			...base,
			systemPrompt: "Changed prefix\n\nvolatile tail",
			systemPromptStableLength: "Changed prefix".length,
		});

		expect(volatileChanged.volatileSystemPromptHash).not.toBe(original.volatileSystemPromptHash);
		expect(volatileChanged.cachePrefixHash).toBe(original.cachePrefixHash);
		expect(stableChanged.stableSystemPromptHash).not.toBe(original.stableSystemPromptHash);
		expect(stableChanged.cachePrefixHash).not.toBe(original.cachePrefixHash);
	});

	it("canonicalizes schema object keys while preserving tool order", () => {
		const base = context();
		const reorderedKeys = context();
		const readParameters = base.tools?.[0]?.parameters;
		if (!readParameters) throw new Error("Missing read tool parameters");
		reorderedKeys.tools = [
			{
				name: "read",
				description: "Read",
				parameters: {
					...readParameters,
					properties: { b: Type.Number(), a: Type.String() },
				},
			},
			{ name: "write", description: "Write", parameters: Type.Object({ path: Type.String() }) },
		];
		const reversedTools = { ...reorderedKeys, tools: [...reorderedKeys.tools].reverse() };

		expect(createPromptCacheDiagnostics(reorderedKeys).toolsHash).toBe(createPromptCacheDiagnostics(base).toolsHash);
		expect(createPromptCacheDiagnostics(reversedTools).toolsHash).not.toBe(
			createPromptCacheDiagnostics(base).toolsHash,
		);
	});
});

function context(): Context {
	return {
		systemPrompt: "Stable prefix\n\nvolatile tail",
		systemPromptStableLength: "Stable prefix".length,
		messages: [
			{ role: "user", content: "first", timestamp: 1 },
			assistantMessage(),
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "result" }],
				details: { local: true },
				isError: false,
				timestamp: 3,
			},
			{ role: "user", content: "current request", timestamp: 4 },
		],
		tools: [
			{ name: "read", description: "Read", parameters: Type.Object({ a: Type.String(), b: Type.Number() }) },
			{ name: "write", description: "Write", parameters: Type.Object({ path: Type.String() }) },
		],
	};
}

function assistantMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "response" }],
		api: "openai-responses",
		provider: "test",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
}
