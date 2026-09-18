import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import { conversationItemRenderKey } from "@shared/conversation/item-key";
import type { ChatConversationItem, TextBlock } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { appendError, fullHistoryToChat } from "./chat-service";
import { applyAgentEndHistoryRefresh, patchLiveMessagesWithCanonical } from "./live-history-patch";

function textBlock(text: string): TextBlock {
	return { type: "text", id: "block-1", text };
}

describe("patchLiveMessagesWithCanonical", () => {
	it("用户发完一轮后，只给乐观气泡补上 entryId，助手正文块保持原引用", () => {
		const blocks = [textBlock("流式正文不会被整表替换冲掉")];
		const live: ChatConversationItem[] = [
			createConversationUserMessage({ id: "live-user", text: "帮我改这里" }),
			createConversationAgentMessage({ id: "live-agent", text: "流式正文不会被整表替换冲掉", blocks }),
		];
		const canonical: ChatConversationItem[] = [
			createConversationUserMessage({
				id: "e-u1",
				entryId: "e-u1",
				parentId: "root",
				branch: { siblings: ["e-u1"], index: 0 },
				text: "帮我改这里",
			}),
			createConversationAgentMessage({
				id: "e-a1",
				entryId: "e-a1",
				text: "落盘里可能更短",
				blocks: [textBlock("落盘里可能更短")],
			}),
		];

		const patched = patchLiveMessagesWithCanonical(live, canonical);
		expect(patched).not.toBeNull();
		expect(patched?.[0]).toMatchObject({
			kind: "user",
			id: "live-user",
			entryId: "e-u1",
			parentId: "root",
			deliveryPhase: "completed",
			text: "帮我改这里",
		});
		expect(patched?.[1]).toMatchObject({
			kind: "agent",
			id: "live-agent",
			entryId: "e-a1",
			text: "流式正文不会被整表替换冲掉",
		});
		expect(patched?.[1].kind === "agent" && patched[1].blocks).toBe(blocks);
		expect(conversationItemRenderKey(patched![0])).toBe("live-user");
		expect(conversationItemRenderKey(patched![1])).toBe("live-agent");
	});

	it("身份已经对齐时保持原消息对象，避免无意义的列表重绘", () => {
		const live: ChatConversationItem[] = [
			createConversationUserMessage({ id: "u", entryId: "e-u1", text: "hi" }),
			createConversationAgentMessage({ id: "a", entryId: "e-a1", text: "ok", blocks: [] }),
		];
		const patched = patchLiveMessagesWithCanonical(live, live);
		expect(patched?.[0]).toBe(live[0]);
		expect(patched?.[1]).toBe(live[1]);
	});

	it("条数对不上时放弃补丁，交给完整历史路径", () => {
		const live: ChatConversationItem[] = [createConversationUserMessage({ id: "u", text: "hi" })];
		const canonical: ChatConversationItem[] = [
			createConversationUserMessage({ id: "e-u1", entryId: "e-u1", text: "hi" }),
			createConversationAgentMessage({ id: "e-a1", entryId: "e-a1", text: "ok", blocks: [] }),
		];
		expect(patchLiveMessagesWithCanonical(live, canonical)).toBeNull();
	});
});

describe("applyAgentEndHistoryRefresh", () => {
	it("落后的 agent_end 历史不会清掉刚显示的错误卡片", () => {
		const live = appendError(
			[createConversationUserMessage({ id: "user-live", text: "hello" })],
			"provider quota exhausted",
			undefined,
			"turn-1",
			{ code: "AI_BILLING_REQUIRED", provider: "deepseek", retryable: false },
		);
		const staleHistory = fullHistoryToChat([
			{ type: "message", entryId: "user-1", message: { role: "user", content: "hello", timestamp: 1 } },
		]);

		const refreshed = applyAgentEndHistoryRefresh(live, staleHistory);
		const last = refreshed.at(-1);
		expect(last?.kind).toBe("agent");
		expect(last?.kind === "agent" && last.blocks).toEqual([
			expect.objectContaining({
				type: "error",
				turnId: "turn-1",
				text: "provider quota exhausted",
			}),
		]);
	});
});
