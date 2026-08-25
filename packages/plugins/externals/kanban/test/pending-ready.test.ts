import { describe, expect, it } from "vitest";
import { addCard, createCard, moveCard, setIdeaState } from "../src/board/board-store";
import {
	cancelPendingReady,
	duePendingReady,
	EMPTY_PENDING_READY,
	PENDING_READY_MS,
	pendingReadySeconds,
	prunePendingReady,
	startPendingReady,
} from "../src/board/pending-ready";
import { createEmptyBoard, type KanbanBoard } from "../src/board/types";

const NOW = 1_700_000_000_000;

function boardWithDraft(id = "c1"): KanbanBoard {
	const board = createEmptyBoard("/work");
	return addCard(board, createCard(board, { title: id }, NOW, id));
}

describe("pending-ready", () => {
	it("挂起后在窗口内不到期，窗口结束后到期", () => {
		const map = startPendingReady(EMPTY_PENDING_READY, "c1", NOW);
		expect(duePendingReady(map, NOW + PENDING_READY_MS - 1)).toEqual([]);
		expect(duePendingReady(map, NOW + PENDING_READY_MS)).toEqual(["c1"]);
	});

	it("倒计时秒数向上取整、显示 5→1 而不是 4→0", () => {
		const map = startPendingReady(EMPTY_PENDING_READY, "c1", NOW);
		expect(pendingReadySeconds(map, "c1", NOW)).toBe(5);
		expect(pendingReadySeconds(map, "c1", NOW + 4_100)).toBe(1);
		// 已到期但还没被收割：钳在 1，不显示 0 或负数。
		expect(pendingReadySeconds(map, "c1", NOW + 6_000)).toBe(1);
		expect(pendingReadySeconds(map, "c2", NOW)).toBeNull();
	});

	it("撤回删除挂起项；撤回不存在的卡片返回原 Map", () => {
		const map = startPendingReady(EMPTY_PENDING_READY, "c1", NOW);
		expect(cancelPendingReady(map, "c1").size).toBe(0);
		expect(cancelPendingReady(map, "missing")).toBe(map);
	});

	it("重复挂起同一张卡刷新到期时间", () => {
		let map = startPendingReady(EMPTY_PENDING_READY, "c1", NOW);
		map = startPendingReady(map, "c1", NOW + 3_000);
		expect(duePendingReady(map, NOW + PENDING_READY_MS)).toEqual([]);
		expect(duePendingReady(map, NOW + 3_000 + PENDING_READY_MS)).toEqual(["c1"]);
	});

	it("prune：卡片仍是灵感池草稿时保留", () => {
		const map = startPendingReady(EMPTY_PENDING_READY, "c1", NOW);
		expect(prunePendingReady(map, boardWithDraft())).toBe(map);
	});

	it("prune：卡片被删 / 拖出灵感池 / 已被别处标为待认领时剔除", () => {
		const map = startPendingReady(EMPTY_PENDING_READY, "c1", NOW);
		expect(prunePendingReady(map, createEmptyBoard("/work")).size).toBe(0);
		expect(prunePendingReady(map, moveCard(boardWithDraft(), "c1", "doing", null, NOW)).size).toBe(0);
		expect(prunePendingReady(map, setIdeaState(boardWithDraft(), "c1", "ready", NOW)).size).toBe(0);
	});
});
