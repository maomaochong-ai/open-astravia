import type { UserMessage } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import {
	createAgentSession,
	SessionInputQueue,
	type SessionInputQueueSnapshot,
	type StoredConversation,
	type TurnPipeline,
	type TurnResult,
} from "../../src/kernel/index.js";

describe("SessionInputQueue 条目管理（ADR-0060）", () => {
	it("enqueueWithId 返回条目 id，list 按 steering 在前 followUp 在后给出快照", () => {
		const queue = new SessionInputQueue();
		const followUp = queue.enqueueWithId("followUp", { message: userMessage("later") });
		const steer = queue.enqueueWithId("steer", { message: userMessage("now") });

		const snapshot = queue.list();
		expect(snapshot.paused).toBe(false);
		expect(snapshot.entries.map((entry) => [entry.id, entry.behavior])).toEqual([
			[steer.id, "steer"],
			[followUp.id, "followUp"],
		]);
	});

	it("remove / reorderFollowUps / promoteToSteering 按 id 生效", () => {
		const queue = new SessionInputQueue();
		const a = queue.enqueueWithId("followUp", { message: userMessage("a") });
		const b = queue.enqueueWithId("followUp", { message: userMessage("b") });
		const c = queue.enqueueWithId("followUp", { message: userMessage("c") });

		expect(queue.remove(b.id)).toBe(true);
		expect(queue.remove("missing")).toBe(false);

		queue.reorderFollowUps([c.id, a.id]);
		expect(queue.list().entries.map((entry) => entry.id)).toEqual([c.id, a.id]);

		expect(queue.promoteToSteering(a.id)).toBe(true);
		const snapshot = queue.list();
		expect(snapshot.entries.map((entry) => [entry.id, entry.behavior])).toEqual([
			[a.id, "steer"],
			[c.id, "followUp"],
		]);
	});

	it("pause 期间 take* 返回空且不消耗条目，resume 后恢复消费", () => {
		const queue = new SessionInputQueue();
		queue.enqueueWithId("steer", { message: userMessage("s") });
		queue.enqueueWithId("followUp", { message: userMessage("f") });

		queue.pause();
		expect(queue.takeSteeringInputs()).toEqual([]);
		expect(queue.takeFollowUpInputs()).toEqual([]);
		expect(queue.pendingCount).toBe(2);

		queue.resume();
		expect(queue.takeSteeringInputs()).toHaveLength(1);
		expect(queue.takeFollowUpInputs()).toHaveLength(1);
		expect(queue.pendingCount).toBe(0);
	});

	it("restore 用快照整体替换，含 paused 状态", () => {
		const source = new SessionInputQueue();
		source.enqueueWithId("followUp", { message: userMessage("persisted") });
		source.pause();
		const snapshot = source.list();

		const restored = new SessionInputQueue();
		restored.enqueueWithId("followUp", { message: userMessage("stale") });
		restored.restore(snapshot);

		const state = restored.list();
		expect(state.paused).toBe(true);
		expect(state.entries).toHaveLength(1);
		expect(state.entries[0]?.input.message?.content).toBe("persisted");
	});

	it("onChange 在入队、消费、移除、暂停时各触发一次，快照可直接序列化", () => {
		const changes: SessionInputQueueSnapshot[] = [];
		const queue = new SessionInputQueue({ onChange: (snapshot) => changes.push(snapshot) });

		const entry = queue.enqueueWithId("followUp", { message: userMessage("x") });
		queue.takeFollowUpInputs();
		queue.enqueueWithId("followUp", { message: userMessage("y") });
		queue.remove(changes.at(-1)?.entries[0]?.id ?? "");
		queue.pause();

		expect(changes).toHaveLength(5);
		expect(entry.id).toBeTruthy();
		expect(() => JSON.stringify(changes.at(-1))).not.toThrow();
		// pause 幂等：重复调用不再触发。
		queue.pause();
		expect(changes).toHaveLength(5);
	});
});

describe("AgentSession 队列生命周期（ADR-0060）", () => {
	it("running 期间带 streamingBehavior 的 send 返回带条目 id 的 queued 回执", async () => {
		const fixture = createFixture({ blockRun: true });
		const session = await createAgentSession({ id: "s", pipeline: fixture.pipeline });
		const active = session.send({ message: userMessage("first") });
		await vi.waitFor(() => expect(fixture.runTurn).toHaveBeenCalledOnce());

		const result = await session.send({ message: userMessage("queued") }, { streamingBehavior: "followUp" });
		expect(result).toMatchObject({ status: "queued", behavior: "followUp", pendingCount: 1 });
		expect(result.status === "queued" && result.id).toBeTruthy();

		fixture.completeRun();
		await active;
	});

	it("turn 以 cancelled 收尾且队列非空时进入 paused（pause-on-terminal）", async () => {
		const fixture = createFixture({ blockRun: true });
		const session = await createAgentSession({ id: "s", pipeline: fixture.pipeline });
		const active = session.send({ message: userMessage("first") });
		await vi.waitFor(() => expect(fixture.runTurn).toHaveBeenCalledOnce());
		await session.send({ message: userMessage("queued") }, { streamingBehavior: "followUp" });

		fixture.completeRun(cancelledTurn("turn-run"));
		await active;

		const snapshot = session.listQueue();
		expect(snapshot.paused).toBe(true);
		expect(snapshot.entries).toHaveLength(1);
	});

	it("resumeQueue 解除暂停并以 followUp 队首开启新 turn", async () => {
		const fixture = createFixture({ blockRun: true });
		const session = await createAgentSession({ id: "s", pipeline: fixture.pipeline });
		const active = session.send({ message: userMessage("first") });
		await vi.waitFor(() => expect(fixture.runTurn).toHaveBeenCalledOnce());
		await session.send({ message: userMessage("queued-head") }, { streamingBehavior: "followUp" });
		fixture.completeRun(cancelledTurn("turn-run"));
		await active;
		expect(session.listQueue().paused).toBe(true);

		const result = await session.resumeQueue();

		expect(result?.status).toBe("completed");
		expect(fixture.runTurn).toHaveBeenCalledTimes(2);
		const input = fixture.runTurn.mock.calls[1]?.[1];
		expect(input?.message.content).toBe("queued-head");
		const snapshot = session.listQueue();
		expect(snapshot.paused).toBe(false);
		expect(snapshot.entries).toHaveLength(0);
	});

	it("sendQueuedNow 在 running 时打断当前 turn，并立刻以该条目开新 turn；其余条目保持可消费", async () => {
		const runs: Array<{ input: unknown; signal: AbortSignal }> = [];
		const runTurn = vi.fn(
			(_identity: unknown, input: { message?: { content?: unknown } } | undefined, signal: AbortSignal) => {
				runs.push({ input, signal });
				if (runs.length === 1) {
					return new Promise<TurnResult>((resolve) => {
						signal.addEventListener("abort", () => resolve(cancelledTurn("turn-1")));
					});
				}
				return Promise.resolve(completedTurn("turn-2"));
			},
		);
		const pipeline = {
			createSession: vi.fn(async (): Promise<StoredConversation> => conversation()),
			run: runTurn,
			continue: vi.fn(async () => completedTurn("turn-continuation")),
			recordContext: vi.fn(async () => {}),
		} as unknown as TurnPipeline;
		const session = await createAgentSession({ id: "s", pipeline });

		const active = session.send({ message: userMessage("first") });
		await vi.waitFor(() => expect(runTurn).toHaveBeenCalledOnce());
		const queuedA = await session.send({ message: userMessage("jump the queue") }, { streamingBehavior: "followUp" });
		await session.send({ message: userMessage("stay queued") }, { streamingBehavior: "followUp" });
		if (queuedA.status !== "queued" || !queuedA.id) throw new Error("expected queued receipt with id");

		const result = await session.sendQueuedNow(queuedA.id);

		expect(result.status).toBe("started");
		await expect(active).resolves.toMatchObject({ status: "cancelled" });
		if (result.status === "started") {
			await expect(result.turn).resolves.toMatchObject({ status: "completed" });
		}
		expect(runTurn).toHaveBeenCalledTimes(2);
		const secondInput = runs[1]?.input as { message?: { content?: unknown } };
		expect(secondInput.message?.content).toBe("jump the queue");
		const snapshot = session.listQueue();
		expect(snapshot.paused).toBe(false);
		expect(snapshot.entries.map((entry) => entry.input.message?.content)).toEqual(["stay queued"]);
	});

	it("自然完成的 turn 不触发暂停，队列保持可消费", async () => {
		const fixture = createFixture({ blockRun: true });
		const session = await createAgentSession({ id: "s", pipeline: fixture.pipeline });
		const active = session.send({ message: userMessage("first") });
		await vi.waitFor(() => expect(fixture.runTurn).toHaveBeenCalledOnce());
		await session.send({ message: userMessage("queued") }, { streamingBehavior: "followUp" });

		fixture.completeRun();
		await active;

		expect(session.listQueue().paused).toBe(false);
	});
});

function createFixture(options: { readonly blockRun?: boolean } = {}) {
	let completeRun = (_result: TurnResult = completedTurn("turn-run")) => {};
	const runResult = options.blockRun
		? new Promise<TurnResult>((resolve) => {
				completeRun = (result = completedTurn("turn-run")) => resolve(result);
			})
		: Promise.resolve(completedTurn("turn-run"));
	let firstRun = true;
	const runTurn = vi.fn<TurnPipeline["run"]>(() => {
		if (firstRun) {
			firstRun = false;
			return runResult;
		}
		return Promise.resolve(completedTurn("turn-followup"));
	});
	const pipeline = {
		createSession: vi.fn(async (): Promise<StoredConversation> => conversation()),
		run: runTurn,
		continue: vi.fn(async () => completedTurn("turn-continuation")),
		recordContext: vi.fn(async () => {}),
	} as unknown as TurnPipeline;
	return { pipeline, runTurn, completeRun };
}

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function completedTurn(turnId: string): TurnResult {
	return { status: "completed", sessionId: "session", turnId, stopReason: "stop", messages: [] };
}

function cancelledTurn(turnId: string): TurnResult {
	return { status: "cancelled", sessionId: "session", turnId, messages: [] };
}

function conversation(): StoredConversation {
	return { sessionId: "session", createdAt: 1, version: 0, messages: [], events: [] };
}
