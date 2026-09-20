import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import type { ChatConversationItem, ErrorBlock, TextBlock, ToolCallBlock } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { planFailedResendRollback } from "./failed-resend-rollback";

function errorBlock(text: string): ErrorBlock {
	return { type: "error", id: "err-1", text, kind: "quota" };
}

function textBlock(text: string): TextBlock {
	return { type: "text", id: "block-1", text };
}

function toolCallBlock(): ToolCallBlock {
	return { type: "tool_call", toolCallId: "tc-1", toolName: "edit", args: {}, status: "success" };
}

function user(text: string, entryId?: string): ChatConversationItem {
	return createConversationUserMessage({ id: `u-${text}`, text, ...(entryId ? { entryId } : {}) });
}

describe("planFailedResendRollback", () => {
	it("prompt 前置失败后原样重发：回退那条空转的用户消息", () => {
		const messages: ChatConversationItem[] = [
			user("继续", "e-u1"),
			createConversationAgentMessage({ id: "a-1", blocks: [errorBlock("prompt rejected")] }),
		];

		expect(planFailedResendRollback(messages, "继续")).toEqual({ entryId: "e-u1", truncateFrom: 0 });
	});

	it("跑了很久才撞 402：不回退，否则整轮工作成果会被硬删", () => {
		// 用户上一次也发的「继续」，Agent 干了一堆活，最后才被配额打断。
		const messages: ChatConversationItem[] = [
			user("先看看这个项目", "e-u0"),
			createConversationAgentMessage({ id: "a-0", text: "看完了", blocks: [textBlock("看完了")] }),
			user("继续", "e-u1"),
			createConversationAgentMessage({
				id: "a-1",
				text: "改了几个文件",
				blocks: [textBlock("改了几个文件"), toolCallBlock(), errorBlock("402 额度已用尽")],
			}),
		];

		expect(planFailedResendRollback(messages, "继续")).toBeNull();
	});

	it("出错的 agent 消息不紧邻用户消息时不回退", () => {
		const messages: ChatConversationItem[] = [
			user("继续", "e-u1"),
			createConversationAgentMessage({ id: "a-1", text: "干活中", blocks: [textBlock("干活中")] }),
			{
				kind: "event",
				id: "ev-1",
				event: { kind: "compaction", summary: "压缩摘要" },
				timestamp: 1,
			} as ChatConversationItem,
			createConversationAgentMessage({ id: "a-2", blocks: [errorBlock("402 额度已用尽")] }),
		];

		expect(planFailedResendRollback(messages, "继续")).toBeNull();
	});

	it("文本不同不回退", () => {
		const messages: ChatConversationItem[] = [
			user("继续", "e-u1"),
			createConversationAgentMessage({ id: "a-1", blocks: [errorBlock("prompt rejected")] }),
		];

		expect(planFailedResendRollback(messages, "接着来")).toBeNull();
	});

	it("用户消息没落盘（无 entryId）时不回退", () => {
		const messages: ChatConversationItem[] = [
			user("继续"),
			createConversationAgentMessage({ id: "a-1", blocks: [errorBlock("prompt rejected")] }),
		];

		expect(planFailedResendRollback(messages, "继续")).toBeNull();
	});

	it("最后一条不是带错误的 agent 消息时不回退", () => {
		const messages: ChatConversationItem[] = [
			user("继续", "e-u1"),
			createConversationAgentMessage({ id: "a-1", text: "好的", blocks: [textBlock("好的")] }),
		];

		expect(planFailedResendRollback(messages, "继续")).toBeNull();
	});
});
