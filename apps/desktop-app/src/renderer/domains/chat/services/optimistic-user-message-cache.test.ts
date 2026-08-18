import type { ChatMessage } from "@shared/store/atoms";
import { beforeEach, describe, expect, it } from "vitest";
import {
	clearOptimisticUserMessages,
	reconcileOptimisticUserMessages,
	rememberOptimisticUserMessage,
} from "./optimistic-user-message-cache";

function user(id: string, text: string): ChatMessage {
	return { id, role: "user", text };
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

	it("不同 runtime 的待确认气泡互不串会话", () => {
		const optimistic = user("optimistic-a", "session a");
		rememberOptimisticUserMessage("runtime-a", optimistic, []);

		expect(reconcileOptimisticUserMessages("runtime-b", [])).toEqual([]);
		expect(reconcileOptimisticUserMessages("runtime-a", [])).toEqual([optimistic]);
	});
});
