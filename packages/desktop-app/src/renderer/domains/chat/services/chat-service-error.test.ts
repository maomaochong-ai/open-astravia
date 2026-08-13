import type { ErrorBlock } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { appendError, fullHistoryToChat, historyToChat } from "./chat-service";

/** 会话文件里一条失败的 assistant message。 */
function failed(errorMessage: string) {
	return { role: "assistant", content: [], stopReason: "error", errorMessage };
}

function errorBlocksOf(messages: ReturnType<typeof historyToChat>): ErrorBlock[] {
	return messages.flatMap((m) => (m.blocks ?? []).filter((b): b is ErrorBlock => b.type === "error"));
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

	it("被工具调用隔开的同类错误不合并", () => {
		const errors = errorBlocksOf(
			historyToChat([
				failed("500 server error"),
				{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "read", arguments: {} }] },
				failed("500 server error"),
			]),
		);

		expect(errors).toHaveLength(2);
	});
});

describe("appendError", () => {
	it("写入时归类，并记下自动重试次数", () => {
		const messages = appendError([], "429 rate limit", 3);
		const block = (messages.at(-1)?.blocks ?? []).at(-1) as ErrorBlock;

		expect(block.kind).toBe("rate_limit");
		expect(block.attempts).toBe(3);
	});

	it("没重试过时不写 attempts", () => {
		const messages = appendError([], "401 Unauthorized");
		const block = (messages.at(-1)?.blocks ?? []).at(-1) as ErrorBlock;

		expect(block.kind).toBe("auth");
		expect(block.attempts).toBeUndefined();
	});
});

describe("fullHistoryToChat error entries", () => {
	it("renders a durable turn failure as an error card", () => {
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "hello", timestamp: 1 } },
			{
				type: "error",
				entryId: "error-1",
				code: "TRANSPORT_FAILED",
				message: "503 service unavailable",
				timestamp: "2026-08-13T00:00:00.000Z",
			},
		]);

		expect(errorBlocksOf(messages)).toEqual([
			expect.objectContaining({ type: "error", kind: "server", text: "503 service unavailable" }),
		]);
	});
});
