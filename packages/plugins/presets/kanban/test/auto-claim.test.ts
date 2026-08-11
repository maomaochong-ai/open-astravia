import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanBoardController } from "../src/board/board-controller";
import { findCard } from "../src/board/board-store";

/**
 * 自动认领的编排层测试。规则（该派哪些卡）在 dispatch.test.ts 里测；这里只测
 * controller 的三条不变量：不重入、不无限重试、开关关着时一张都不派。
 */

interface FakeHost {
	ctx: PluginContext;
	created: string[];
	prompts: Array<{ sessionId: string; text: string }>;
	/** 让下一次建会话失败，模拟宿主报错。 */
	failCreate: boolean;
	/** 建会话的并发峰值：串行派单时必须始终是 1。 */
	peakConcurrentCreates: number;
	stored: Record<string, unknown>;
}

function createHost(initialBoard?: unknown): FakeHost {
	const host: FakeHost = {
		created: [],
		prompts: [],
		failCreate: false,
		peakConcurrentCreates: 0,
		stored: initialBoard === undefined ? {} : { board: initialBoard },
		ctx: undefined as unknown as PluginContext,
	};
	let inFlight = 0;
	let seq = 0;

	host.ctx = {
		i18n: { t: (key: string) => key },
		ui: { notify: vi.fn() },
		storage: {
			readJson: async (key: string) => host.stored[key],
			writeJson: async (key: string, value: unknown) => {
				host.stored[key] = value;
			},
		},
		official: {
			projects: { list: async () => ({ projects: [], workspacePath: "" }) },
			models: { list: async () => ({ providers: [], defaultModel: "" }) },
			sessions: {
				listRunning: async () => [],
				onRunningChanged: () => () => undefined,
				create: async ({ title }: { title: string }) => {
					inFlight += 1;
					host.peakConcurrentCreates = Math.max(host.peakConcurrentCreates, inFlight);
					// 跨一个宏任务再返回：串行不成立的话，两次 create 会在这里重叠。
					await new Promise((resolve) => setTimeout(resolve, 0));
					inFlight -= 1;
					if (host.failCreate) throw new Error("host refused");
					seq += 1;
					host.created.push(title);
					return { sessionId: `s${seq}`, sessionPath: `/s/${seq}.jsonl` };
				},
				prompt: async (sessionId: string, text: string) => {
					host.prompts.push({ sessionId, text });
				},
			},
		},
	} as unknown as PluginContext;

	return host;
}

/** 让 controller 里已排队的自动认领循环跑完。 */
async function settle(): Promise<void> {
	for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function readyCard(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return { id, title: id, lane: "inbox", ideaState: "ready", cwd: "/work", ...extra };
}

describe("自动认领", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("关着时不派任何卡片", async () => {
		const host = createHost({ autoClaim: false, cards: [readyCard("c1")] });
		const controller = new KanbanBoardController(host.ctx);
		await controller.ensureLoaded();
		await settle();
		expect(host.created).toEqual([]);
		expect(findCard(controller.getBoard(), "c1")?.lane).toBe("inbox");
	});

	it("载入时就把攒下的待认领卡片派出去，并标记为 agent 认领", async () => {
		const host = createHost({ autoClaim: true, cards: [readyCard("c1"), readyCard("c2")] });
		const controller = new KanbanBoardController(host.ctx);
		await controller.ensureLoaded();
		await settle();
		expect(host.created).toEqual(["c1", "c2"]);
		expect(host.prompts).toHaveLength(2);
		expect(findCard(controller.getBoard(), "c1")).toMatchObject({ lane: "doing", claimedBy: "agent" });
	});

	it("串行派单：并发上限没被绕过，建会话不会重叠", async () => {
		const cards = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((id) => readyCard(id));
		const host = createHost({ autoClaim: true, concurrency: 3, cards });
		const controller = new KanbanBoardController(host.ctx);
		await controller.ensureLoaded();
		await settle();
		expect(host.peakConcurrentCreates).toBe(1);
		// 名额只有 3 个，多出来的卡片留在灵感池等交付。
		expect(host.created).toEqual(["c1", "c2", "c3"]);
	});

	it("草稿不被自动认领；标为待认领后立刻开工", async () => {
		const host = createHost({ autoClaim: true, cards: [readyCard("c1", { ideaState: "draft" })] });
		const controller = new KanbanBoardController(host.ctx);
		await controller.ensureLoaded();
		await settle();
		expect(host.created).toEqual([]);

		controller.setIdeaState("c1", "ready");
		await settle();
		expect(host.created).toEqual(["c1"]);
	});

	it("开开关时把已经在池里的待认领卡片补派掉", async () => {
		const host = createHost({ autoClaim: false, cards: [readyCard("c1")] });
		const controller = new KanbanBoardController(host.ctx);
		await controller.ensureLoaded();
		await settle();
		expect(host.created).toEqual([]);

		controller.setAutoClaim(true);
		await settle();
		expect(host.created).toEqual(["c1"]);
		expect(host.stored.board).toMatchObject({ autoClaim: true });
	});

	it("解析不出目标项目的卡片被跳过，不会拖住后面的卡片", async () => {
		const host = createHost({
			autoClaim: true,
			defaultCwd: "",
			cards: [readyCard("c1", { cwd: "" }), readyCard("c2")],
		});
		const controller = new KanbanBoardController(host.ctx);
		await controller.ensureLoaded();
		await settle();
		expect(host.created).toEqual(["c2"]);
		expect(findCard(controller.getBoard(), "c1")?.lane).toBe("inbox");
	});

	it("建会话失败的卡片不被无限重试", async () => {
		const host = createHost({ autoClaim: true, cards: [readyCard("c1")] });
		host.failCreate = true;
		const controller = new KanbanBoardController(host.ctx);
		await controller.ensureLoaded();
		await settle();
		// 失败会把卡片留在「正在处理」并置 failed（名额已吐回），不该反复重派。
		expect(findCard(controller.getBoard(), "c1")).toMatchObject({ lane: "doing", runState: "failed" });
		expect(host.created).toEqual([]);
	});
});
