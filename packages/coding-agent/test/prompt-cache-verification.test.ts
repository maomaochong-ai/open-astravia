import type { AgentMessage } from "@vetta/agent-core";
import {
	type Api,
	type AssistantMessage,
	createPromptCacheDiagnostics,
	type Message,
	type Model,
	type ToolResultMessage,
	type UserMessage,
} from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { estimateContextTokens } from "../src/compaction/index.js";
import { projectModelCallContext } from "../src/compaction/runtime/model-call-context-projection.js";
import { buildSystemPromptDraft, compileSystemPromptDraft } from "../src/model-context/index.js";

describe("prompt cache verification", () => {
	it("keeps an append-only Tool Loop cache-compatible below context pressure", async () => {
		const firstRequest = conversation();
		const firstTokens = estimateContextTokens(firstRequest satisfies AgentMessage[]).tokens;
		const firstResponse = assistant(
			[{ type: "toolCall", id: "current-call", name: "read", arguments: { path: "current.txt" } }],
			firstTokens,
		);
		const secondRequest = [...firstRequest, firstResponse, toolResult("current-call", "current result", 100)];
		const contextWindow = estimateContextTokens(secondRequest satisfies AgentMessage[]).tokens * 4;

		const firstProjection = await project(firstRequest, contextWindow);
		const firstDiagnostics = createPromptCacheDiagnostics({ messages: [...firstProjection] });
		const diagnosedResponse = withDiagnostics(firstResponse, firstDiagnostics);
		const secondProjection = await project(
			[...firstRequest, diagnosedResponse, toolResult("current-call", "current result", 100)],
			contextWindow,
		);
		const secondDiagnostics = createPromptCacheDiagnostics({ messages: [...secondProjection] });

		expect(firstDivergentMessage(firstProjection, secondProjection)).toBe(firstProjection.length);
		expect(secondDiagnostics).toMatchObject({ prefixStatus: "extended", changedSegments: [] });
	});

	it("proves that crossing the soft pressure threshold rewrites old history", async () => {
		const firstRequest = conversation();
		const firstTokens = estimateContextTokens(firstRequest satisfies AgentMessage[]).tokens;
		const firstResponse = assistant(
			[{ type: "toolCall", id: "current-call", name: "read", arguments: { path: "current.txt" } }],
			firstTokens,
		);
		const secondRequest = [...firstRequest, firstResponse, toolResult("current-call", "current result", 100)];
		const secondTokens = estimateContextTokens(secondRequest satisfies AgentMessage[]).tokens;
		const contextWindow = firstTokens * 2 + 1;
		expect(firstTokens / contextWindow).toBeLessThan(0.5);
		expect(secondTokens / contextWindow).toBeGreaterThanOrEqual(0.5);

		const firstProjection = await project(firstRequest, contextWindow);
		const firstDiagnostics = createPromptCacheDiagnostics({ messages: [...firstProjection] });
		const diagnosedResponse = withDiagnostics(firstResponse, firstDiagnostics);
		const secondProjection = await project(
			[...firstRequest, diagnosedResponse, toolResult("current-call", "current result", 100)],
			contextWindow,
		);
		const secondDiagnostics = createPromptCacheDiagnostics({ messages: [...secondProjection] });

		expect(firstDivergentMessage(firstProjection, secondProjection)).toBe(2);
		expect(text(firstProjection[2])).not.toContain("shortened by context pressure");
		expect(text(secondProjection[2])).toContain("shortened by context pressure");
		expect(secondDiagnostics).toMatchObject({
			prefixStatus: "changed",
			changedSegments: ["messages"],
		});
	});

	it("classifies a host-supplied mode prompt as part of the volatile system tail", () => {
		// 模式注册表归宿主所有（ADR-0071 修订）：这里只验证 core.mode 槽位的缓存分层，
		// 用合成正文即可，正文长度与内容是 desktop 注册表的事实。
		const modePrompt = `You are operating in **Coding mode**.\n${"mode guidance line.\n".repeat(400)}`;
		const draft = buildSystemPromptDraft({
			cwd: "C:\\workspace",
			modePrompt,
			scenario: "conversation",
			selectedTools: [],
		});
		const compiled = compileSystemPromptDraft(draft);
		const modeBlock = draft.blocks.find(({ id }) => id === "core.mode");

		expect(modeBlock).toMatchObject({ cacheability: "volatile", priority: 850 });
		expect(modePrompt.length).toBeGreaterThan(7_000);
		expect(compiled.content.slice(compiled.stableLength)).toContain(modePrompt);
	});
});

async function project(messages: readonly Message[], contextWindow: number): Promise<readonly Message[]> {
	const result = await projectModelCallContext(
		{
			sessionId: "session-1",
			turnId: "turn-1",
			messages,
			modelBinding: { model: { ...MODEL, contextWindow } },
		},
		async (input) => input,
		new AbortController().signal,
		{ timeBoundary: 1_000 },
	);
	return result.messages;
}

function conversation(): Message[] {
	const messages: Message[] = [];
	for (let index = 0; index < 5; index += 1) {
		const callId = `history-call-${index}`;
		messages.push(user(`history request ${index}`, index * 3 + 1));
		messages.push(
			assistant(
				[{ type: "toolCall", id: callId, name: "read", arguments: { path: `history-${index}.txt` } }],
				estimateContextTokens(messages satisfies AgentMessage[]).tokens,
				index * 3 + 2,
			),
		);
		messages.push(toolResult(callId, `${"x".repeat(9 * 1024)}-${index}`, index * 3 + 3));
	}
	messages.push(user("current request", 99));
	return messages;
}

function user(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
}

function toolResult(toolCallId: string, content: string, timestamp: number): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text: content }],
		isError: false,
		timestamp,
	};
}

function assistant(content: AssistantMessage["content"], promptTokens: number, timestamp = 100): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "test",
		model: "test",
		usage: {
			input: promptTokens,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: promptTokens + 1,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: content.some(({ type }) => type === "toolCall") ? "toolUse" : "stop",
		timestamp,
	};
}

function withDiagnostics(
	message: AssistantMessage,
	diagnostics: ReturnType<typeof createPromptCacheDiagnostics>,
): AssistantMessage {
	return { ...message, usage: { ...message.usage, promptCache: diagnostics } };
}

function firstDivergentMessage(previous: readonly Message[], current: readonly Message[]): number {
	const sharedLength = Math.min(previous.length, current.length);
	for (let index = 0; index < sharedLength; index += 1) {
		if (JSON.stringify(previous[index]) !== JSON.stringify(current[index])) return index;
	}
	return sharedLength;
}

function text(message: Message | undefined): string {
	if (!message || message.role !== "toolResult") return "";
	return message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("");
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 4_096,
};
