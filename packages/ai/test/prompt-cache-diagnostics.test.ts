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
		const toolResult = changed.messages[2];
		if (toolResult?.role !== "toolResult") throw new Error("Missing tool result fixture");
		changed.messages[2] = { ...toolResult, details: { local: "changed" }, timestamp: 888 };
		changed.messages[3] = { role: "user", content: "a different current request", timestamp: 777 };

		const next = createPromptCacheDiagnostics(changed);
		const { requestMessagesHash: firstRequestHash, ...firstPrefix } = first;
		const { requestMessagesHash: nextRequestHash, ...nextPrefix } = next;
		expect(nextPrefix).toEqual(firstPrefix);
		expect(nextRequestHash).not.toBe(firstRequestHash);
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

	it("classifies append-only conversations and isolates changed prefix segments", () => {
		const firstContext: Context = {
			systemPrompt: "Stable prefix\n\nvolatile tail",
			systemPromptStableLength: "Stable prefix".length,
			messages: [{ role: "user", content: "first request", timestamp: 1 }],
			tools: context().tools,
		};
		const first = createPromptCacheDiagnostics(firstContext);
		expect(first.prefixStatus).toBe("initial");

		const previousResponse = assistantMessage();
		previousResponse.usage.promptCache = first;
		const continued: Context = {
			...firstContext,
			messages: [
				...firstContext.messages,
				previousResponse,
				{ role: "user", content: "next request", timestamp: 3 },
			],
		};
		const extended = createPromptCacheDiagnostics(continued);
		expect(extended.prefixStatus).toBe("extended");
		expect(extended.changedSegments).toEqual([]);

		const volatileChanged = createPromptCacheDiagnostics({
			...continued,
			systemPrompt: "Stable prefix\n\na different volatile tail",
		});
		expect(volatileChanged.prefixStatus).toBe("extended");
		expect(volatileChanged.changedSegments).toEqual(["volatile-system"]);

		const stableChanged = createPromptCacheDiagnostics({
			...continued,
			systemPrompt: "Changed prefix\n\nvolatile tail",
			systemPromptStableLength: "Changed prefix".length,
		});
		expect(stableChanged.prefixStatus).toBe("changed");
		expect(stableChanged.changedSegments).toEqual(["stable-system"]);

		const toolsChanged = createPromptCacheDiagnostics({
			...continued,
			tools: [...(continued.tools ?? [])].reverse(),
		});
		expect(toolsChanged.prefixStatus).toBe("changed");
		expect(toolsChanged.changedSegments).toEqual(["tools"]);

		const messagesChanged = createPromptCacheDiagnostics({
			...continued,
			messages: [{ role: "user", content: "rewritten", timestamp: 1 }, ...continued.messages.slice(1)],
		});
		expect(messagesChanged.prefixStatus).toBe("changed");
		expect(messagesChanged.changedSegments).toEqual(["messages"]);
	});

	it("marks historical diagnostics without lineage fields as unknown", () => {
		const previousResponse = assistantMessage();
		previousResponse.usage.promptCache = createPromptCacheDiagnostics({ messages: [] });
		delete previousResponse.usage.promptCache.requestMessagesHash;
		delete previousResponse.usage.promptCache.requestMessageCount;

		const diagnostics = createPromptCacheDiagnostics({
			messages: [previousResponse, { role: "user", content: "next", timestamp: 3 }],
		});

		expect(diagnostics.prefixStatus).toBe("unknown");
		expect(diagnostics.changedSegments).toEqual([]);
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
