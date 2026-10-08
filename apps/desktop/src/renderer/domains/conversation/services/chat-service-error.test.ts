// @vitest-environment jsdom

import { createConversationUserMessage } from "@shared/conversation";
import type { ChatConversationItem, ErrorBlock } from "@shared/store/chat-atoms";
import { type ConversationFeedState, createConversationFeedState } from "@shared/store/chat-atoms";
import type { AssistantMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { fullHistoryToChat, historyToChat } from "./chat-service";
import { type ConversationFeedAction, reduceConversationFeed } from "./conversation-feed";

function feedWith(...actions: ConversationFeedAction[]): ConversationFeedState {
	return actions.reduce(reduceConversationFeed, createConversationFeedState());
}

function feedError(
	message: string,
	options: Omit<Extract<ConversationFeedAction, { type: "error.appended" }>, "type" | "message" | "timestamp"> = {},
): ConversationFeedAction {
	return { type: "error.appended", message, timestamp: 1, ...options };
}

/** 会话文件里一条失败的 assistant message。 */
function failed(errorMessage: string) {
	return { role: "assistant", content: [], stopReason: "error", errorMessage };
}

/** 持久化历史里完整的 assistant message。 */
function durableAssistant(overrides: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "qwen",
		model: "qwen3.8-flash-next",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
		...overrides,
	};
}

function errorBlocksOf(messages: readonly ChatConversationItem[]): ErrorBlock[] {
	return messages.flatMap((message) =>
		message.kind === "agent" ? message.blocks.filter((block): block is ErrorBlock => block.type === "error") : [],
	);
}

describe("历史回放的错误折叠", () => {
	it("连续同类错误合成一条并计数", () => {
		const messages = historyToChat([
			{ role: "user", content: "hi" },
			failed("429 rate limit"),
			failed("429 rate limit"),
			failed("429 rate limit"),
		]);

		const errors = errorBlocksOf(messages);
		expect(errors).toHaveLength(1);
		expect(errors[0].kind).toBe("rate_limit");
		expect(errors[0].repeated).toBe(3);
	});

	it("不同类的错误不合并", () => {
		const errors = errorBlocksOf(historyToChat([failed("429 rate limit"), failed("401 Unauthorized")]));

		expect(errors.map((e) => e.kind)).toEqual(["rate_limit", "auth"]);
		expect(errors.every((e) => e.repeated === undefined)).toBe(true);
	});

	it("合并后保留末次原文（配额类末次才带重置时间）", () => {
		const errors = errorBlocksOf(
			historyToChat([failed("429 窗口额度已用尽"), failed("429 窗口额度已用尽，将于 18:00 重置")]),
		);

		expect(errors).toHaveLength(1);
		expect(errors[0].text).toBe("429 窗口额度已用尽，将于 18:00 重置");
	});

	it("被用户消息隔开的同类错误不合并", () => {
		const errors = errorBlocksOf(
			historyToChat([failed("500 server error"), { role: "user", content: "again" }, failed("500 server error")]),
		);

		expect(errors).toHaveLength(2);
	});

	it("同一轮里随后成功的失败尝试不再显示错误", () => {
		const messages = historyToChat([
			{ role: "user", content: "hi" },
			failed("429 rate limit"),
			{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
		]);

		expect(errorBlocksOf(messages)).toEqual([]);
		expect(messages.at(-1)).toMatchObject({ kind: "agent", text: "done" });
	});

	it("失败后被用户中断的尝试仍显示错误", () => {
		const errors = errorBlocksOf(
			historyToChat([
				{ role: "user", content: "hi" },
				failed("500 server error"),
				{ role: "assistant", content: [], stopReason: "aborted" },
			]),
		);

		expect(errors).toHaveLength(1);
	});
});

describe("feed error blocks", () => {
	it("写入时归类，并记下自动重试次数", () => {
		const block = errorBlocksOf(feedWith(feedError("429 rate limit", { attempts: 3 })).items).at(-1) as ErrorBlock;

		expect(block.kind).toBe("rate_limit");
		expect(block.attempts).toBe(3);
	});

	it("没重试过时不写 attempts", () => {
		const block = errorBlocksOf(feedWith(feedError("401 Unauthorized")).items).at(-1) as ErrorBlock;

		expect(block.kind).toBe("auth");
		expect(block.attempts).toBeUndefined();
	});

	it("同一 turn 重放错误事件时保持单个错误块", () => {
		const twice = feedWith(
			feedError("503 unavailable", { turnId: "turn-1" }),
			feedError("503 unavailable", {
				turnId: "turn-1",
				attempts: 1,
				details: { code: "TRANSPORT_FAILED", origin: "provider", statusCode: 503, provider: "deepseek" },
			}),
		);
		expect(errorBlocksOf(twice.items)).toHaveLength(1);
		expect(errorBlocksOf(twice.items)[0]).toMatchObject({
			turnId: "turn-1",
			attempts: 1,
			details: { code: "TRANSPORT_FAILED", origin: "provider", statusCode: 503, provider: "deepseek" },
		});
	});
});

describe("fullHistoryToChat error entries", () => {
	it("hides a context overflow that auto compaction recovered within the turn", () => {
		const overflow = "400 This model's maximum context length is 200000 tokens.";
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "read everything", timestamp: 1 } },
			{ type: "message", message: durableAssistant({ stopReason: "error", errorMessage: overflow }) },
			{ type: "compaction", entryId: "compaction-1", summary: "summary", tokensBefore: 193_000, timestamp: "2" },
			{ type: "message", message: durableAssistant({ content: [{ type: "text", text: "done" }] }) },
		]);

		expect(errorBlocksOf(messages)).toEqual([]);
		expect(messages.map((message) => message.kind)).toEqual(["user", "agent", "event", "agent"]);
	});

	it("keeps an overflow that ended the turn", () => {
		const overflow = "400 This model's maximum context length is 200000 tokens.";
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "read everything", timestamp: 1 } },
			{ type: "message", message: durableAssistant({ stopReason: "error", errorMessage: overflow }) },
			{ type: "message", message: { role: "user", content: "next", timestamp: 3 } },
		]);

		expect(errorBlocksOf(messages)).toEqual([expect.objectContaining({ text: overflow })]);
	});

	it("renders a durable turn failure as an error card", () => {
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "hello", timestamp: 1 } },
			{
				type: "error",
				entryId: "error-1",
				turnId: "turn-1",
				code: "TRANSPORT_FAILED",
				retryable: false,
				origin: "provider",
				details: { statusCode: 503, provider: "deepseek", modelId: "deepseek-chat", phase: "response" },
				message: "503 service unavailable",
				timestamp: "2026-08-13T00:00:00.000Z",
			},
		]);

		expect(errorBlocksOf(messages)).toEqual([
			expect.objectContaining({
				type: "error",
				kind: "server",
				text: "503 service unavailable",
				turnId: "turn-1",
				details: {
					code: "TRANSPORT_FAILED",
					origin: "provider",
					retryable: false,
					statusCode: 503,
					provider: "deepseek",
					modelId: "deepseek-chat",
					phase: "response",
				},
			}),
		]);
	});

	it("deduplicates the assistant error message and durable turn failure", () => {
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "hello", timestamp: 1 } },
			{
				type: "message",
				entryId: "assistant-error-1",
				message: {
					role: "assistant",
					content: [],
					api: "openai-responses",
					provider: "deepseek",
					model: "deepseek-chat",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error",
					errorMessage: "provider quota exhausted",
					timestamp: 2,
				} satisfies AssistantMessage,
			},
			{
				type: "error",
				entryId: "error-1",
				turnId: "turn-1",
				code: "AI_BILLING_REQUIRED",
				message: "provider quota exhausted",
				timestamp: "2026-08-13T00:00:00.000Z",
			},
		]);

		const errors = errorBlocksOf(messages);
		expect(errors).toEqual([
			expect.objectContaining({
				type: "error",
				text: "provider quota exhausted",
				turnId: "turn-1",
			}),
		]);
		expect(errors[0]).not.toHaveProperty("repeated");
	});
});

describe("durable history arriving after a live terminal error", () => {
	it("keeps the live error when the history snapshot does not contain it yet", () => {
		const live = feedWith(
			{ type: "user.sent", message: createConversationUserMessage({ id: "user-1", text: "hello" }) },
			feedError("provider quota exhausted", {
				turnId: "turn-1",
				details: { code: "AI_BILLING_REQUIRED", provider: "deepseek", retryable: false },
			}),
		);
		const staleHistory = fullHistoryToChat([
			{
				type: "message",
				entryId: "user-1",
				messageId: "user-1",
				message: { role: "user", content: "hello", timestamp: 1 },
			},
		]);

		const reconciled = reduceConversationFeed(live, { type: "history.loaded", items: staleHistory, revision: 1 });

		expect(errorBlocksOf(reconciled.items)).toEqual([
			expect.objectContaining({
				turnId: "turn-1",
				text: "provider quota exhausted",
				details: { code: "AI_BILLING_REQUIRED", provider: "deepseek", retryable: false },
			}),
		]);
	});

	it("shows a terminal error already present in history once, keeping its live retry count", () => {
		const live = feedWith(
			feedError("provider quota exhausted", {
				turnId: "turn-1",
				attempts: 2,
				details: { code: "AI_BILLING_REQUIRED", provider: "deepseek" },
			}),
		);
		const history = fullHistoryToChat([
			{
				type: "error",
				entryId: "error-1",
				turnId: "turn-1",
				code: "AI_BILLING_REQUIRED",
				message: "provider quota exhausted",
				timestamp: "2026-08-13T00:00:00.000Z",
			},
		]);

		const reconciled = reduceConversationFeed(live, { type: "history.loaded", items: history, revision: 1 });

		expect(errorBlocksOf(reconciled.items)).toHaveLength(1);
		expect(errorBlocksOf(reconciled.items)[0]).toMatchObject({ turnId: "turn-1", attempts: 2 });
	});
});
