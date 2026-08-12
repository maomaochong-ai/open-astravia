import { describe, expect, it } from "vitest";
import { INITIAL_PET_BUBBLE_QUEUE_STATE, type PetBubbleQueueState, reducePetBubbleQueue } from "./pet-bubble-state";

function show(
	state: PetBubbleQueueState,
	text: string,
	options: { dedupeKey?: string; sessionId?: string; priority?: "normal" | "high"; source?: "app" | "user" } = {},
	now = 0,
): PetBubbleQueueState {
	return reducePetBubbleQueue(state, { type: "show", now, input: { text, ...options } });
}

describe("reducePetBubbleQueue", () => {
	it("updates the same session status slot instead of queueing stale progress", () => {
		const started = show(INITIAL_PET_BUBBLE_QUEUE_STATE, "开始", {
			dedupeKey: "session-status",
			sessionId: "s1",
		});
		const working = show(started, "正在读取文件", { dedupeKey: "session-status", sessionId: "s1" }, 2_000);

		expect(working.current?.text).toBe("正在读取文件");
		expect(working.pending).toEqual([]);
		expect(working.current?.id).not.toBe(started.current?.id);
	});

	it("refreshes repeated legacy text in place", () => {
		const first = show(INITIAL_PET_BUBBLE_QUEUE_STATE, "相同消息");
		const waiting = show(first, "相同消息", {}, 1_000);
		const refreshed = show(waiting, "相同消息", {}, 2_000);

		expect(refreshed.current?.text).toBe("相同消息");
		expect(refreshed.current?.id).not.toBe(first.current?.id);
		expect(refreshed.pending).toEqual([]);
	});

	it("queues ordinary notices from another session and promotes them after expiry", () => {
		const current = show(INITIAL_PET_BUBBLE_QUEUE_STATE, "会话一", { dedupeKey: "session-status", sessionId: "s1" });
		const queued = show(current, "会话二", { dedupeKey: "session-status", sessionId: "s2" });

		expect(queued.current?.text).toBe("会话一");
		expect(queued.pending.map((message) => message.text)).toEqual(["会话二"]);
		const promoted = reducePetBubbleQueue(queued, {
			type: "advance",
			messageId: queued.current?.id ?? -1,
			now: 2_000,
		});
		expect(promoted.current?.text).toBe("会话二");
	});

	it("lets high-priority errors preempt and suppress stale ordinary notices", () => {
		const current = show(INITIAL_PET_BUBBLE_QUEUE_STATE, "正在工作", {
			dedupeKey: "session-status",
			sessionId: "s1",
		});
		const queued = show(current, "其他会话更新", { dedupeKey: "session-status", sessionId: "s2" });
		const failed = show(queued, "出错了", {
			priority: "high",
			dedupeKey: "session-status",
			sessionId: "s1",
		});
		const ignored = show(failed, "处理完成");

		expect(failed.current?.text).toBe("出错了");
		expect(failed.pending).toEqual([]);
		expect(ignored.current?.text).toBe("出错了");
		expect(ignored.pending).toEqual([]);
	});

	it("keeps user notices in front of ordinary app notices", () => {
		const user = show(INITIAL_PET_BUBBLE_QUEUE_STATE, "用户消息", { source: "user" }, 1_000);
		const ignored = show(user, "应用消息", {}, 2_000);
		const urgent = show(user, "紧急错误", { priority: "high" }, 2_000);

		expect(ignored).toBe(user);
		expect(urgent.current?.text).toBe("紧急错误");
	});

	it("allows an explicit user notice to replace an app error", () => {
		const failed = show(INITIAL_PET_BUBBLE_QUEUE_STATE, "应用错误", { priority: "high" });
		const user = show(failed, "用户消息", { source: "user" });

		expect(user.current?.text).toBe("用户消息");
		expect(user.pending).toEqual([]);
	});
});
