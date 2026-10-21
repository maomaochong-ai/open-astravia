import type { AgentMessage } from "@astravia/agent-core";
import {
	type Api,
	type AssistantMessage,
	createPromptCacheDiagnostics,
	type Message,
	type Model,
	type ToolResultMessage,
	type UserMessage,
} from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { estimateContextTokens } from "../src/compaction/index.js";
import { projectModelCallContext } from "../src/compaction/runtime/model-call-context-projection.js";
import { renderGoalInstructions } from "../src/features/goal/goal-instructions.js";
import type { CodingAgentGoalState } from "../src/features/goal/index.js";
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

	it("places a host-owned shared prefix before a volatile participant identity", () => {
		const draft = buildSystemPromptDraft({
			cwd: "C:\\workspace",
			selectedTools: [],
			systemPromptCachePrefixAddon: "Shared Team roster revision 7",
			systemPromptVolatileAddon: "Current participant: builder",
		});
		const compiled = compileSystemPromptDraft(draft);
		const stable = compiled.content.slice(0, compiled.stableLength);
		const volatile = compiled.content.slice(compiled.stableLength);

		expect(stable).toContain("Shared Team roster revision 7");
		expect(stable).not.toContain("Current participant: builder");
		expect(volatile).toContain("Current participant: builder");
		expect(compiled.promptCacheBlocks.find(({ id }) => id === "core.cache-prefix-addon")).toMatchObject({
			cacheability: "stable",
		});
		expect(compiled.promptCacheBlocks.find(({ id }) => id === "core.volatile-addon")).toMatchObject({
			cacheability: "volatile",
		});
	});

	it("keeps the MCP tool index out of the cached system prefix", () => {
		// MCP 目录会随服务器连接、断开与刷新而变；它若落在稳定段中部，任一变动都会作废其后的项目指令缓存。
		const before = compileSystemPromptDraft(
			buildSystemPromptDraft({ cwd: "/workspace", mcpDeferred: true, mcpTools: [], selectedTools: [] }),
		);
		const after = compileSystemPromptDraft(
			buildSystemPromptDraft({
				cwd: "/workspace",
				mcpDeferred: true,
				mcpTools: [{ name: "mcp_docs_search", description: "search the documentation" }],
				selectedTools: [],
			}),
		);

		expect(after.stableLength).toBe(before.stableLength);
		expect(after.content.slice(0, after.stableLength)).toBe(before.content.slice(0, before.stableLength));
		expect(after.content.slice(after.stableLength)).toContain("mcp_docs_search");
		expect(after.promptCacheBlocks.find(({ id }) => id === "core.mcp")).toMatchObject({ cacheability: "volatile" });
	});

	it("keeps the goal instruction free of per-turn counters", () => {
		// tokensUsed 每轮都增长；写进系统提示词会让整个历史消息缓存每轮失效，而它不影响任何模型判断。
		const goal: CodingAgentGoalState = {
			goalId: "goal-1",
			objective: "ship the release",
			status: "active",
			tokensUsed: 1_000,
			timeUsedSeconds: 60,
			continuationCount: 2,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:01:00.000Z",
		};

		expect(renderGoalInstructions({ ...goal, tokensUsed: 1_000 })).toBe(
			renderGoalInstructions({ ...goal, tokensUsed: 987_654 }),
		);
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
