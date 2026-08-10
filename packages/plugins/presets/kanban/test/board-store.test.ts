import { describe, expect, it } from "vitest";
import {
	addCard,
	applyRunningSessions,
	createCard,
	findCard,
	laneCards,
	moveCard,
	parseBoard,
	removeCard,
	setConcurrency,
	setIdeaState,
	updateCard,
} from "../src/board/board-store";
import { createEmptyBoard, DEFAULT_CONCURRENCY, type KanbanBoard } from "../src/board/types";

const NOW = 1_700_000_000_000;

function boardWith(...titles: string[]): KanbanBoard {
	return titles.reduce<KanbanBoard>(
		(board, title, index) => addCard(board, createCard(board, { title }, NOW + index, `c${index + 1}`)),
		createEmptyBoard("/work"),
	);
}

describe("createCard", () => {
	it("默认落在灵感池的草稿状态", () => {
		const card = createCard(createEmptyBoard(), { title: "  想法  " }, NOW, "c1");
		expect(card.lane).toBe("inbox");
		expect(card.ideaState).toBe("draft");
		expect(card.title).toBe("想法");
		expect(card.priority).toBe(0);
	});

	it("非法 lane / priority 归一到安全值", () => {
		const card = createCard(
			createEmptyBoard(),
			{ title: "x", lane: "nope" as never, priority: 9 as never },
			NOW,
			"c1",
		);
		expect(card.lane).toBe("inbox");
		expect(card.priority).toBe(0);
	});

	it("order 在泳道内递增", () => {
		const board = boardWith("a", "b", "c");
		expect(laneCards(board, "inbox").map((card) => card.title)).toEqual(["a", "b", "c"]);
	});
});

describe("moveCard", () => {
	it("跨泳道移动并重排 order", () => {
		const board = moveCard(boardWith("a", "b", "c"), "c2", "doing", null, NOW);
		expect(laneCards(board, "doing").map((card) => card.id)).toEqual(["c2"]);
		expect(laneCards(board, "inbox").map((card) => card.id)).toEqual(["c1", "c3"]);
	});

	it("插到指定卡片之前", () => {
		const board = moveCard(boardWith("a", "b", "c"), "c3", "inbox", "c1", NOW);
		expect(laneCards(board, "inbox").map((card) => card.id)).toEqual(["c3", "c1", "c2"]);
	});

	it("移出灵感池后 ideaState 归一为 ready", () => {
		const board = moveCard(boardWith("a"), "c1", "doing", null, NOW);
		expect(findCard(board, "c1")?.ideaState).toBe("ready");
	});

	it("未知卡片原样返回", () => {
		const board = boardWith("a");
		expect(moveCard(board, "nope", "doing", null, NOW)).toBe(board);
	});
});

describe("removeCard", () => {
	it("删除卡片并清理其它卡片对它的悬空依赖", () => {
		let board = boardWith("a", "b");
		board = updateCard(board, "c2", { dependsOn: ["c1"] }, NOW);
		board = removeCard(board, "c1");
		expect(findCard(board, "c1")).toBeUndefined();
		expect(findCard(board, "c2")?.dependsOn).toEqual([]);
	});

	it("删除不存在的卡片返回原对象", () => {
		const board = boardWith("a");
		expect(removeCard(board, "nope")).toBe(board);
	});
});

describe("setIdeaState", () => {
	it("只对灵感池卡片生效", () => {
		const board = moveCard(boardWith("a"), "c1", "doing", null, NOW);
		expect(setIdeaState(board, "c1", "draft", NOW)).toBe(board);
	});

	it("草稿转待认领", () => {
		const board = setIdeaState(boardWith("a"), "c1", "ready", NOW);
		expect(findCard(board, "c1")?.ideaState).toBe("ready");
	});
});

describe("setConcurrency", () => {
	it("夹在 1..20 之间", () => {
		expect(setConcurrency(createEmptyBoard(), 0).concurrency).toBe(1);
		expect(setConcurrency(createEmptyBoard(), 999).concurrency).toBe(20);
		expect(setConcurrency(createEmptyBoard(), 3.6).concurrency).toBe(4);
	});

	it("值未变时返回原对象", () => {
		const board = createEmptyBoard();
		expect(setConcurrency(board, DEFAULT_CONCURRENCY)).toBe(board);
	});
});

describe("applyRunningSessions", () => {
	function doingBoard(): KanbanBoard {
		let board = moveCard(boardWith("a", "b"), "c1", "doing", null, NOW);
		board = moveCard(board, "c2", "doing", null, NOW);
		board = updateCard(board, "c1", { sessionPath: "/s/a.jsonl", runState: "queued" }, NOW);
		return updateCard(board, "c2", { sessionPath: "/s/b.jsonl", runState: "queued" }, NOW);
	}

	it("在运行集合里的卡片标记为 running", () => {
		const board = applyRunningSessions(doingBoard(), new Set(["/s/a.jsonl"]), NOW);
		expect(findCard(board, "c1")?.runState).toBe("running");
	});

	it("曾经 running 的卡片离开运行集合后降为 waiting", () => {
		let board = applyRunningSessions(doingBoard(), new Set(["/s/a.jsonl"]), NOW);
		board = applyRunningSessions(board, new Set(), NOW);
		expect(findCard(board, "c1")?.runState).toBe("waiting");
	});

	it("已派单但还没开跑的卡片保持 queued，不被误判为 waiting", () => {
		const board = applyRunningSessions(doingBoard(), new Set(), NOW);
		expect(findCard(board, "c2")?.runState).toBe("queued");
	});

	it("终态不被运行态覆盖", () => {
		const board = updateCard(doingBoard(), "c1", { runState: "done" }, NOW);
		expect(applyRunningSessions(board, new Set(["/s/a.jsonl"]), NOW)).toBe(board);
	});

	it("没有变化时返回原对象", () => {
		const board = doingBoard();
		expect(applyRunningSessions(board, new Set(), NOW)).toBe(board);
	});
});

describe("parseBoard", () => {
	it("空/脏输入退化为空看板", () => {
		expect(parseBoard(null, "/w").cards).toEqual([]);
		expect(parseBoard("x", "/w").defaultCwd).toBe("/w");
		expect(parseBoard({ cards: "nope" }).cards).toEqual([]);
	});

	it("丢弃坏卡片但保留其余", () => {
		const board = parseBoard({ cards: [{ id: "c1", title: "ok" }, null, { title: "no id" }, 42] });
		expect(board.cards.map((card) => card.id)).toEqual(["c1"]);
	});

	it("跨重启把 running 降级为 waiting", () => {
		const board = parseBoard({ cards: [{ id: "c1", title: "t", lane: "doing", runState: "running" }] });
		expect(board.cards[0].runState).toBe("waiting");
	});

	it("并发值被夹到合法区间，非法值回落默认", () => {
		expect(parseBoard({ concurrency: 100 }).concurrency).toBe(20);
		expect(parseBoard({ concurrency: "x" }).concurrency).toBe(DEFAULT_CONCURRENCY);
	});

	it("落盘再解析后卡片信息稳定", () => {
		let board = boardWith("a");
		board = updateCard(board, "c1", { tags: ["x"], dependsOn: [], priority: 2, sessionPath: "/s.jsonl" }, NOW);
		const round = parseBoard(JSON.parse(JSON.stringify(board)));
		expect(round.cards[0]).toMatchObject({ id: "c1", title: "a", priority: 2, tags: ["x"], sessionPath: "/s.jsonl" });
	});
});
