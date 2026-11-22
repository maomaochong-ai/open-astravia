import type { ChatConversationItem } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { resolvePendingMessageEdit } from "./pending-message-edit";

function user(entryId: string | undefined, id = entryId ?? "local"): ChatConversationItem {
	return {
		kind: "user",
		id,
		entryId,
		deliveryPhase: "completed",
		text: "hi",
		timestamp: 0,
	} as unknown as ChatConversationItem;
}

function agent(id: string): ChatConversationItem {
	return { kind: "agent", id, text: "ok", blocks: [], timestamp: 0 } as unknown as ChatConversationItem;
}

describe("resolvePendingMessageEdit", () => {
	it("accepts the edit only when it targets the last user message", () => {
		const messages = [user("u1"), agent("a1"), user("u2"), agent("a2")];
		expect(resolvePendingMessageEdit(messages, { entryId: "u2" })).toEqual({ entryId: "u2" });
	});

	it("drops an edit that points at an older user message", () => {
		// 旧消息已被回复覆盖：替换它等于删掉一整轮问答，必须拒绝。
		const messages = [user("u1"), agent("a1"), user("u2")];
		expect(resolvePendingMessageEdit(messages, { entryId: "u1" })).toBeNull();
	});

	it("drops an edit whose entry is no longer in the feed", () => {
		expect(resolvePendingMessageEdit([user("u2")], { entryId: "gone" })).toBeNull();
	});

	it("drops an edit when the feed has no user message yet", () => {
		expect(resolvePendingMessageEdit([agent("a1")], { entryId: "u1" })).toBeNull();
		expect(resolvePendingMessageEdit([], { entryId: "u1" })).toBeNull();
	});

	it("treats an optimistic message without entryId as not editable", () => {
		// 还没落盘的乐观气泡没有 entryId：替换无从下手，按普通发送处理。
		expect(resolvePendingMessageEdit([user(undefined, "local-1")], { entryId: "local-1" })).toBeNull();
	});

	it("returns null when nothing is pending", () => {
		expect(resolvePendingMessageEdit([user("u1")], null)).toBeNull();
	});
});
