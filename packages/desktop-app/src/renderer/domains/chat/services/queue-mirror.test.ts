import type { QueuedMessage } from "@shared/store/message-queue-atoms";
import { beforeEach, describe, expect, it } from "vitest";
import { diffConsumedQueueEntries, markQueueEntrySelfRemoved, resetQueueMirrorStateForTest } from "./queue-mirror";

function entry(id: string, text = id): QueuedMessage {
	return { id, displayText: text, behavior: "followUp" };
}

describe("diffConsumedQueueEntries（ADR-0060 队列镜像差分）", () => {
	beforeEach(() => {
		resetQueueMirrorStateForTest();
	});

	it("条目消失且非本端移除 ⇒ 判定为已被 turn 消费", () => {
		const prev = [entry("a", "第一条"), entry("b", "第二条")];
		const next = [entry("b", "第二条")];
		expect(diffConsumedQueueEntries(prev, next)).toEqual([entry("a", "第一条")]);
	});

	it("本端主动移除的条目不算消费（不补气泡），且记账一次性生效", () => {
		markQueueEntrySelfRemoved("a");
		expect(diffConsumedQueueEntries([entry("a")], [])).toEqual([]);
		// 记账已消费：同 id 再次消失（理论上不会发生）会被当作消费。
		expect(diffConsumedQueueEntries([entry("a")], [])).toEqual([entry("a")]);
	});

	it("新增条目（入队）不产生任何消费判定", () => {
		expect(diffConsumedQueueEntries([], [entry("a")])).toEqual([]);
	});

	it("promote（behavior 变化但 id 保留）不算消费", () => {
		const prev = [entry("a")];
		const next: QueuedMessage[] = [{ id: "a", displayText: "a", behavior: "steer" }];
		expect(diffConsumedQueueEntries(prev, next)).toEqual([]);
	});

	it("一次事件里多条消失按原顺序全部判定消费（followUp mode=all 场景）", () => {
		const prev = [entry("a"), entry("b"), entry("c")];
		expect(diffConsumedQueueEntries(prev, [entry("c")])).toEqual([entry("a"), entry("b")]);
	});
});
