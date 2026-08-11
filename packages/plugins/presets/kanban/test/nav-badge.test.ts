import { describe, expect, it } from "vitest";
import { addCard, createCard, moveCard, updateCard } from "../src/board/board-store";
import { boardNavBadge } from "../src/board/nav-badge";
import { createEmptyBoard, type KanbanBoard, type KanbanRunState } from "../src/board/types";

const NOW = 1_700_000_000_000;

function seed(count: number): KanbanBoard {
	let board = createEmptyBoard("/work");
	for (let index = 0; index < count; index += 1) {
		board = addCard(board, createCard(board, { title: `t${index + 1}` }, NOW + index, `c${index + 1}`));
	}
	return board;
}

/** 把指定卡片派进「正在处理」。 */
function doing(board: KanbanBoard, id: string, runState: KanbanRunState = "running"): KanbanBoard {
	return updateCard(moveCard(board, id, "doing", null, NOW), id, { runState }, NOW);
}

describe("boardNavBadge", () => {
	it("空闲时是 Beta 标识", () => {
		expect(boardNavBadge(seed(0))).toEqual({ kind: "beta" });
		expect(boardNavBadge(seed(3))).toEqual({ kind: "beta" });
	});

	it("有任务在跑就报数量，盖过 Beta", () => {
		const board = doing(doing(seed(3), "c1"), "c2", "queued");
		expect(boardNavBadge(board)).toEqual({ kind: "count", count: 2 });
	});

	it("任务清零后 Beta 自己回来", () => {
		const running = doing(seed(1), "c1");
		expect(boardNavBadge(running)).toEqual({ kind: "count", count: 1 });
		expect(boardNavBadge(moveCard(running, "c1", "review", null, NOW))).toEqual({ kind: "beta" });
	});

	it("口径与并发名额一致：已交付/失败的卡不再算作处理中", () => {
		// 这两张还留在 doing 泳道，但不占名额——角标要是把它们算进去，侧边栏就会
		// 比板上的 n/5 名额环多报几个，用户没法判断哪个是真的。
		const board = doing(doing(doing(seed(3), "c1"), "c2", "done"), "c3", "failed");
		expect(boardNavBadge(board)).toEqual({ kind: "count", count: 1 });
	});
});
