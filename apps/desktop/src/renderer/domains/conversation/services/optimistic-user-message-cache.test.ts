import { type ConversationUserMessageViewModel, createConversationUserMessage } from "@shared/conversation";
import { beforeEach, describe, expect, it } from "vitest";
import {
	clearOptimisticUserMessages,
	reconcileOptimisticUserMessages,
	rememberOptimisticUserMessage,
} from "./optimistic-user-message-cache";

function user(id: string, text: string): ConversationUserMessageViewModel {
	return createConversationUserMessage({ id, text });
}

beforeEach(() => clearOptimisticUserMessages());

describe("optimistic user message reconciliation", () => {
	it("历史尚未写入本轮用户消息时保留乐观气泡", () => {
		const history = [user("persisted-1", "first")];
		const optimistic = user("optimistic-2", "second");
		rememberOptimisticUserMessage("runtime-a", optimistic, history);

		expect(reconcileOptimisticUserMessages("runtime-a", history)).toEqual([...history, optimistic]);
	});

	it("历史在对应序号出现同一用户消息后移除乐观气泡", () => {
		const previous = user("persisted-1", "same text");
		const optimistic = { ...user("optimistic-2", "same text"), attachments: [] };
		rememberOptimisticUserMessage("runtime-a", optimistic, [previous]);

		const canonical = user("persisted-2", "same text");
		expect(reconcileOptimisticUserMessages("runtime-a", [previous, canonical])).toEqual([previous, canonical]);
		expect(reconcileOptimisticUserMessages("runtime-a", [previous, canonical])).toEqual([previous, canonical]);
	});

	it("规范历史确认发送后仍沿用编辑器结构化快照", () => {
		const inputSegments = [
			{ kind: "text" as const, text: "保留 " },
			{ kind: "file" as const, path: "C:/workspace/screenshot.png" },
		];
		const optimistic = createConversationUserMessage({
			id: "optimistic-1",
			text: "保留 @C:/workspace/screenshot.png",
			inputSegments,
			attachments: [{ kind: "file", path: "C:/workspace/screenshot.png" }],
		});
		rememberOptimisticUserMessage("runtime-a", optimistic, []);

		const canonical = createConversationUserMessage({
			id: "persisted-1",
			text: optimistic.text,
			attachments: optimistic.attachments,
		});

		expect(reconcileOptimisticUserMessages("runtime-a", [canonical])).toEqual([{ ...canonical, inputSegments }]);
	});

	it("相同文本只出现在更早序号时不能误确认新消息", () => {
		const previous = user("persisted-1", "repeat");
		const optimistic = user("optimistic-2", "repeat");
		rememberOptimisticUserMessage("runtime-a", optimistic, [previous]);

		expect(reconcileOptimisticUserMessages("runtime-a", [previous])).toEqual([previous, optimistic]);
	});

	it("仅附件消息用 runtime 占位文本落盘后仍能确认", () => {
		const optimistic = { ...user("optimistic-1", ""), attachments: [{ kind: "file" as const, path: "C:\\a.txt" }] };
		rememberOptimisticUserMessage("runtime-a", optimistic, []);

		const canonical = {
			...user("persisted-1", "(see attached content)"),
			attachments: [{ kind: "file" as const, path: "C:\\a.txt" }],
		};
		expect(reconcileOptimisticUserMessages("runtime-a", [canonical])).toEqual([canonical]);
	});

	it("队列消费气泡按 matchTextOnly 吸收：规范消息带附件徽章也不残留重复", () => {
		// 队列镜像只有 displayText；被 turn 消费后规范消息带 attachments，
		// 严格元数据比较会失配，曾导致 agent 回复完成后气泡重复（ADR-0060）。
		const optimistic = user("optimistic-1", "@/cache/img.png badge 字体太大");
		rememberOptimisticUserMessage("runtime-a", optimistic, [], { matchTextOnly: true });

		const canonical = {
			...user("persisted-1", "@/cache/img.png badge 字体太大"),
			attachments: [{ kind: "image" as const, path: "/cache/img.png" }],
		};
		expect(reconcileOptimisticUserMessages("runtime-a", [canonical])).toEqual([canonical]);
		expect(reconcileOptimisticUserMessages("runtime-a", [canonical])).toEqual([canonical]);
	});

	it("matchTextOnly 仍要求文本与序号命中，防止误吸收", () => {
		const optimistic = user("optimistic-1", "second");
		rememberOptimisticUserMessage("runtime-a", optimistic, [user("persisted-1", "first")], {
			matchTextOnly: true,
		});

		const history = [user("persisted-1", "first"), user("persisted-2", "different")];
		expect(reconcileOptimisticUserMessages("runtime-a", history)).toEqual([...history, optimistic]);
	});

	it("永远对不上账的气泡在有限次对账后停止残留", () => {
		// 队列镜像曾为内部 continuation 消息补气泡，而规范历史按 origin 过滤掉它，
		// 于是每次 agent_end 重拉都把这条气泡重新追加到列表末尾，永久残留且错位。
		const optimistic = user("optimistic-1", "Continue the response from where you stopped.");
		rememberOptimisticUserMessage("runtime-a", optimistic, [], { matchTextOnly: true });

		const history = [user("persisted-1", "真实用户消息")];
		expect(reconcileOptimisticUserMessages("runtime-a", history)).toEqual([...history, optimistic]);
		reconcileOptimisticUserMessages("runtime-a", history);
		reconcileOptimisticUserMessages("runtime-a", history);
		expect(reconcileOptimisticUserMessages("runtime-a", history)).toEqual(history);
		expect(reconcileOptimisticUserMessages("runtime-a", history)).toEqual(history);
	});

	it("落盘较慢的气泡不会被误清：历史未到达该序号就一直保留", () => {
		const optimistic = user("optimistic-2", "second");
		rememberOptimisticUserMessage("runtime-a", optimistic, [user("persisted-1", "first")]);

		const history = [user("persisted-1", "first")];
		for (let index = 0; index < 10; index += 1) {
			expect(reconcileOptimisticUserMessages("runtime-a", history)).toEqual([...history, optimistic]);
		}
	});

	it("不同 runtime 的待确认气泡互不串会话", () => {
		const optimistic = user("optimistic-a", "session a");
		rememberOptimisticUserMessage("runtime-a", optimistic, []);

		expect(reconcileOptimisticUserMessages("runtime-b", [])).toEqual([]);
		expect(reconcileOptimisticUserMessages("runtime-a", [])).toEqual([optimistic]);
	});
});
