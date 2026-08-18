import { describe, expect, it } from "vitest";
import { bumpQueuedDispatchSeq, getQueuedDispatchSeq } from "./message-queue-atoms";

describe("queued dispatch seq registry", () => {
	it("未派发过时序号为 0（直发路径：agent_end 序号不变，重拉照常执行）", () => {
		expect(getQueuedDispatchSeq("fresh-session")).toBe(0);
	});

	it("每次派发 +1，用于判定回合结束后是否发生过跨轮派发", () => {
		const s = "s-bump";
		const start = getQueuedDispatchSeq(s);
		bumpQueuedDispatchSeq(s);
		expect(getQueuedDispatchSeq(s)).toBe(start + 1);
		bumpQueuedDispatchSeq(s);
		expect(getQueuedDispatchSeq(s)).toBe(start + 2);
	});

	it("按 runtimeId 隔离", () => {
		bumpQueuedDispatchSeq("s-a");
		const beforeB = getQueuedDispatchSeq("s-b");
		expect(beforeB).toBe(0);
		bumpQueuedDispatchSeq("s-b");
		expect(getQueuedDispatchSeq("s-b")).toBe(1);
	});

	it("判活语义：回合起始快照 == 结束时读数 ⇒ 无跨轮派发（重拉执行）；不等 ⇒ 跳过", () => {
		const s = "s-skip";
		const startSeq = getQueuedDispatchSeq(s);
		// 无派发：相等 → 应执行重拉。
		expect(getQueuedDispatchSeq(s)).toBe(startSeq);
		// 发生一次队列派发后：不等 → 应跳过这次过期重拉。
		bumpQueuedDispatchSeq(s);
		expect(getQueuedDispatchSeq(s)).not.toBe(startSeq);
	});
});
