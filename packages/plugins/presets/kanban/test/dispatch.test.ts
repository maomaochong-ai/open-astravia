import { describe, expect, it } from "vitest";
import { addCard, archiveCard, createCard, moveCard, setConcurrency, updateCard } from "../src/board/board-store";
import {
	autoClaimCandidates,
	blockedCards,
	buildDispatchPrompt,
	buildSendBackPrompt,
	canDispatch,
	dispatchableCards,
	occupyingCards,
	remainingSlots,
	snapshotForAgent,
	unmetDependencies,
} from "../src/board/dispatch";
import { createEmptyBoard, type KanbanBoard } from "../src/board/types";

const NOW = 1_700_000_000_000;

function seed(count: number, cwd = "/work"): KanbanBoard {
	let board = createEmptyBoard(cwd);
	for (let index = 0; index < count; index += 1) {
		board = addCard(board, createCard(board, { title: `t${index + 1}` }, NOW + index, `c${index + 1}`));
		board = updateCard(board, `c${index + 1}`, { ideaState: "ready" }, NOW);
	}
	return board;
}

/** 把前 n 张卡片派进「正在处理」，模拟已占用的名额。 */
function occupy(board: KanbanBoard, ids: string[]): KanbanBoard {
	return ids.reduce((acc, id) => {
		const moved = moveCard(acc, id, "doing", null, NOW);
		return updateCard(moved, id, { runState: "running", sessionPath: `/s/${id}.jsonl` }, NOW);
	}, board);
}

describe("remainingSlots / occupyingCards", () => {
	it("默认并发 5，空板剩 5 个名额", () => {
		expect(remainingSlots(seed(0))).toBe(5);
	});

	it("queued / running / waiting 都占名额", () => {
		let board = seed(3);
		board = occupy(board, ["c1", "c2", "c3"]);
		board = updateCard(board, "c2", { runState: "queued" }, NOW);
		board = updateCard(board, "c3", { runState: "waiting" }, NOW);
		expect(occupyingCards(board)).toHaveLength(3);
		expect(remainingSlots(board)).toBe(2);
	});

	it("done / failed 不再占名额", () => {
		let board = occupy(seed(2), ["c1", "c2"]);
		board = updateCard(board, "c1", { runState: "done" }, NOW);
		board = updateCard(board, "c2", { runState: "failed" }, NOW);
		expect(remainingSlots(board)).toBe(5);
	});

	it("超额占用时名额不为负", () => {
		const board = setConcurrency(occupy(seed(3), ["c1", "c2", "c3"]), 1);
		expect(remainingSlots(board)).toBe(0);
	});
});

describe("canDispatch", () => {
	it("待认领且无依赖时放行，并解析出 cwd", () => {
		const decision = canDispatch(seed(1), "c1");
		expect(decision).toMatchObject({ ok: true, cwd: "/work" });
	});

	it("放行时带上解析后的模型：卡片 > 看板默认 > 空（宿主默认）", () => {
		expect(canDispatch(seed(1), "c1")).toMatchObject({ ok: true, modelKey: "" });

		const boardDefault = { ...seed(1), defaultModelKey: "anthropic/claude-opus-5" };
		expect(canDispatch(boardDefault, "c1")).toMatchObject({ ok: true, modelKey: "anthropic/claude-opus-5" });

		const overridden = updateCard(boardDefault, "c1", { modelKey: "openai/gpt-5" }, NOW);
		expect(canDispatch(overridden, "c1")).toMatchObject({ ok: true, modelKey: "openai/gpt-5" });
	});

	it("卡片 cwd 覆盖看板默认 cwd", () => {
		const board = updateCard(seed(1), "c1", { cwd: "/other" }, NOW);
		expect(canDispatch(board, "c1")).toMatchObject({ ok: true, cwd: "/other" });
	});

	it("草稿不可被认领", () => {
		const board = updateCard(seed(1), "c1", { ideaState: "draft" }, NOW);
		expect(canDispatch(board, "c1")).toEqual({ ok: false, reason: "draft" });
	});

	it("不在灵感池的卡片不可被认领", () => {
		const board = moveCard(seed(1), "c1", "review", null, NOW);
		expect(canDispatch(board, "c1")).toEqual({ ok: false, reason: "not-in-inbox", lane: "review" });
	});

	it("未知卡片给出 not-found", () => {
		expect(canDispatch(seed(1), "nope")).toEqual({ ok: false, reason: "not-found" });
	});

	it("WIP 满时拒绝，并回报当前并发上限", () => {
		const board = setConcurrency(occupy(seed(3), ["c1", "c2"]), 2);
		expect(canDispatch(board, "c3")).toEqual({ ok: false, reason: "wip-full", concurrency: 2 });
	});

	it("依赖未进「待检查」时拒绝，并列出阻塞者", () => {
		const board = updateCard(seed(2), "c2", { dependsOn: ["c1"] }, NOW);
		expect(canDispatch(board, "c2")).toEqual({ ok: false, reason: "blocked", blockedBy: ["c1"] });
	});

	it("依赖进入「待检查」后解除阻塞", () => {
		let board = updateCard(seed(2), "c2", { dependsOn: ["c1"] }, NOW);
		board = moveCard(board, "c1", "review", null, NOW);
		expect(canDispatch(board, "c2")).toMatchObject({ ok: true });
	});

	it("依赖检查先于 WIP 检查——被挡住的卡片不该报「名额满」", () => {
		let board = setConcurrency(seed(3), 1);
		board = updateCard(board, "c3", { dependsOn: ["c1"] }, NOW);
		board = occupy(board, ["c2"]);
		expect(canDispatch(board, "c3")).toEqual({ ok: false, reason: "blocked", blockedBy: ["c1"] });
	});

	it("没有可用 cwd 时拒绝", () => {
		expect(canDispatch(seed(1, ""), "c1")).toEqual({ ok: false, reason: "missing-cwd" });
	});
});

describe("dispatchableCards / blockedCards", () => {
	it("按优先级降序、其次创建时间升序", () => {
		let board = seed(3);
		board = updateCard(board, "c3", { priority: 2 }, NOW);
		expect(dispatchableCards(board).map((card) => card.id)).toEqual(["c3", "c1", "c2"]);
	});

	it("草稿与被阻塞卡片不进可派列表", () => {
		let board = seed(3);
		board = updateCard(board, "c2", { ideaState: "draft" }, NOW);
		board = updateCard(board, "c3", { dependsOn: ["c1"] }, NOW);
		expect(dispatchableCards(board).map((card) => card.id)).toEqual(["c1"]);
		expect(blockedCards(board).map((entry) => entry.card.id)).toEqual(["c3"]);
	});

	it("WIP 满时仍列出可派卡片——闸门交给 canDispatch，避免 agent 误以为没活可干", () => {
		const board = setConcurrency(occupy(seed(2), ["c1"]), 1);
		expect(dispatchableCards(board).map((card) => card.id)).toEqual(["c2"]);
	});
});

describe("autoClaimCandidates", () => {
	const auto = (board: KanbanBoard): KanbanBoard => ({ ...board, autoClaim: true });

	it("关着时不派任何卡片", () => {
		expect(autoClaimCandidates(seed(3))).toEqual([]);
	});

	it("开着时按建议顺序取，最多填满剩余名额", () => {
		const board = setConcurrency(auto(seed(4)), 3);
		expect(autoClaimCandidates(occupy(board, ["c1"])).map((card) => card.id)).toEqual(["c2", "c3"]);
	});

	it("名额满时不派", () => {
		const board = setConcurrency(auto(seed(3)), 1);
		expect(autoClaimCandidates(occupy(board, ["c1"]))).toEqual([]);
	});

	it("草稿与被依赖挡住的卡片不进自动认领", () => {
		let board = auto(seed(3));
		board = updateCard(board, "c2", { ideaState: "draft" }, NOW);
		board = updateCard(board, "c3", { dependsOn: ["c1"] }, NOW);
		expect(autoClaimCandidates(board).map((card) => card.id)).toEqual(["c1"]);
	});

	it("解析不出 cwd 的卡片被排除——自动循环重试它只会空转", () => {
		let board = auto(seed(2, ""));
		board = updateCard(board, "c2", { cwd: "/other" }, NOW);
		expect(autoClaimCandidates(board).map((card) => card.id)).toEqual(["c2"]);
	});
});

describe("unmetDependencies", () => {
	it("忽略已不存在的依赖 id", () => {
		const board = updateCard(seed(1), "c1", { dependsOn: ["ghost"] }, NOW);
		expect(unmetDependencies(board, board.cards[0])).toEqual([]);
	});
});

describe("buildDispatchPrompt", () => {
	it("包含标题、正文与回执要求", () => {
		let board = seed(1);
		board = updateCard(board, "c1", { detail: "做个登录页", tags: ["前端"] }, NOW);
		const prompt = buildDispatchPrompt(board.cards[0]);
		expect(prompt).toContain("# t1");
		expect(prompt).toContain("做个登录页");
		expect(prompt).toContain("前端");
		expect(prompt).toContain("kanban_submit_task");
		expect(prompt).toContain("c1");
	});

	it("无正文时不产生空段落", () => {
		expect(buildDispatchPrompt(seed(1).cards[0])).not.toContain("\n\n\n");
	});
});

describe("snapshotForAgent", () => {
	it("只暴露决策所需信息，并区分待认领与草稿", () => {
		let board = seed(3);
		board = updateCard(board, "c3", { ideaState: "draft" }, NOW);
		board = occupy(board, ["c1"]);
		const snapshot = snapshotForAgent(board);
		expect(snapshot.concurrency).toBe(5);
		expect(snapshot.remainingSlots).toBe(4);
		expect(snapshot.doing.map((card) => card.id)).toEqual(["c1"]);
		expect(snapshot.ready.map((card) => card.id)).toEqual(["c2"]);
		expect(snapshot.draftCount).toBe(1);
	});

	it("没选模型时快照里不出现模型字段，选了才带上", () => {
		const plain = snapshotForAgent(seed(1));
		expect(plain.defaultModelKey).toBeUndefined();
		expect(plain.ready[0].modelKey).toBeUndefined();

		const withModel = snapshotForAgent({ ...seed(1), defaultModelKey: "anthropic/claude-opus-5" });
		expect(withModel.defaultModelKey).toBe("anthropic/claude-opus-5");
		expect(withModel.ready[0].modelKey).toBe("anthropic/claude-opus-5");
	});

	it("待认领项带上阻塞者与解析后的 cwd", () => {
		const board = updateCard(seed(2), "c2", { dependsOn: ["c1"] }, NOW);
		const ready = snapshotForAgent(board).ready;
		expect(ready.find((card) => card.id === "c2")).toMatchObject({ blockedBy: ["c1"], cwd: "/work" });
	});
});

describe("buildSendBackPrompt", () => {
	it("包含卡片标识、反馈、上一轮交付说明与再次提交要求", () => {
		let board = seed(1);
		board = updateCard(board, "c1", { deliveryNote: "已上线登录页" }, NOW);
		const prompt = buildSendBackPrompt(board.cards[0], "按钮颜色不对，改成品牌色");
		expect(prompt).toContain("c1");
		expect(prompt).toContain("按钮颜色不对");
		expect(prompt).toContain("已上线登录页");
		expect(prompt).toContain("kanban_submit_task");
	});

	it("没有交付说明时不渲染对照段", () => {
		expect(buildSendBackPrompt(seed(1).cards[0], "反馈")).not.toContain("上一轮的交付说明");
	});
});

describe("归档卡片与派单的交互", () => {
	it("归档卡不占 WIP 名额、不进 agent 快照", () => {
		let board = occupy(seed(2), ["c1"]);
		board = moveCard(board, "c1", "review", null, NOW);
		board = archiveCard(board, "c1", NOW);
		expect(remainingSlots(board)).toBe(5);
		const snapshot = snapshotForAgent(board);
		expect(snapshot.review).toHaveLength(0);
		expect(snapshot.doing).toHaveLength(0);
	});

	it("已归档的依赖不再阻塞下游（归档 = 已交付）", () => {
		let board = updateCard(seed(2), "c2", { dependsOn: ["c1"] }, NOW);
		board = moveCard(board, "c1", "review", null, NOW);
		board = archiveCard(board, "c1", NOW);
		expect(canDispatch(board, "c2")).toMatchObject({ ok: true });
	});
});
