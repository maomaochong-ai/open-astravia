import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import { conversationItemRenderKey } from "@shared/conversation/item-key";
import type { ChatConversationItem, TextBlock } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { collectModelSwitchLabels } from "../components/message-list/message-list-derived";
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

	it("补丁会把落盘历史上本轮实际使用的模型回填到用户气泡，模型切换横幅无需重开会话", () => {
		const live: ChatConversationItem[] = [
			createConversationUserMessage({
				id: "u1",
				entryId: "e-u1",
				text: "第一轮",
				model: { provider: "openai", id: "gpt-4" },
			}),
			createConversationAgentMessage({ id: "a1", entryId: "e-a1", text: "ok", blocks: [] }),
			// 队列接力消费的镜像气泡只有文本，没有发送时的模型信息。
			createConversationUserMessage({ id: "live-u2", deliveryPhase: "pending", text: "第二轮" }),
			createConversationAgentMessage({ id: "live-a2", text: "done", blocks: [textBlock("done")] }),
		];
		const canonical: ChatConversationItem[] = [
			createConversationUserMessage({
				id: "e-u1",
				entryId: "e-u1",
				text: "第一轮",
				model: { provider: "openai", id: "gpt-4" },
			}),
			createConversationAgentMessage({ id: "e-a1", entryId: "e-a1", text: "ok", blocks: [] }),
			createConversationUserMessage({
				id: "e-u2",
				entryId: "e-u2",
				text: "第二轮",
				model: { provider: "openai", id: "gpt-5" },
			}),
			createConversationAgentMessage({ id: "e-a2", entryId: "e-a2", text: "done", blocks: [] }),
		];

		const patched = patchLiveMessagesWithCanonical(live, canonical);
		expect(patched).not.toBeNull();
		expect(patched?.[0]).toBe(live[0]);
		expect(patched?.[2]).toMatchObject({
			kind: "user",
			id: "live-u2",
			entryId: "e-u2",
			deliveryPhase: "completed",
			model: { provider: "openai", id: "gpt-5" },
		});
		expect(patched?.[3].kind === "agent" && patched[3].blocks).toBe(
			live[3].kind === "agent" ? live[3].blocks : undefined,
		);

		const labels = collectModelSwitchLabels(patched!, new Map([["openai/gpt-5", "GPT-5"]]));
		expect(labels.get("live-u2")).toEqual({ from: "openai/gpt-4", to: "GPT-5" });
		expect(labels.size).toBe(1);
	});

	it("落盘模型与乐观气泡一致时保留原 model 对象，缺失时沿用发送时的选中模型", () => {
		const selected = { provider: "openai", id: "gpt-5" };
		const live: ChatConversationItem[] = [
			createConversationUserMessage({ id: "u1", entryId: "e-u1", text: "hi", model: selected }),
			createConversationAgentMessage({ id: "a1", entryId: "e-a1", text: "ok", blocks: [] }),
			createConversationUserMessage({ id: "u2", text: "again", model: selected }),
			createConversationAgentMessage({ id: "a2", text: "sure", blocks: [] }),
		];
		const canonical: ChatConversationItem[] = [
			createConversationUserMessage({
				id: "e-u1",
				entryId: "e-u1",
				text: "hi",
				model: { provider: "openai", id: "gpt-5" },
			}),
			createConversationAgentMessage({ id: "e-a1", entryId: "e-a1", text: "ok", blocks: [] }),
			// 出错的 assistant 条目没有 provider/model，投影不会给这条 user 打模型。
			createConversationUserMessage({ id: "e-u2", entryId: "e-u2", text: "again" }),
			createConversationAgentMessage({ id: "e-a2", entryId: "e-a2", text: "sure", blocks: [] }),
		];

		const patched = patchLiveMessagesWithCanonical(live, canonical);
		expect(patched?.[0]).toBe(live[0]);
		expect(patched?.[2]).toMatchObject({ id: "u2", entryId: "e-u2", model: selected });
		expect(patched?.[2].kind === "user" && patched[2].model).toBe(selected);
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
