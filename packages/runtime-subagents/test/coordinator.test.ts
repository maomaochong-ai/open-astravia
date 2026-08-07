import { describe, expect, it, vi } from "vitest";
import {
	type SubagentChildEvent,
	type SubagentChildFactory,
	type SubagentChildHandle,
	SubagentCoordinator,
	type SubagentLifecycle,
	type SubagentSnapshot,
	type SubagentSpawnRequest,
	type SubagentTodoProgress,
	type SubagentTypeDefinition,
	SubagentTypeRegistry,
} from "../src/index.js";

interface TestProfile {
	readonly kind: "explorer" | "workflow";
}

describe("SubagentCoordinator", () => {
	it("validates a batch before reserving any child", () => {
		const fixture = createFixture();

		expect(() => fixture.coordinator.spawnMany([request("valid_task"), request("Invalid")])).toThrow(
			"Invalid task_name",
		);
		expect(fixture.coordinator.list()).toEqual([]);
	});

	it("queues overflow in FIFO order and refills the active slot", async () => {
		const fixture = createFixture({ maxConcurrent: 1 });
		const snapshots = fixture.coordinator.spawnMany([request("first"), request("second"), request("third")]);

		expect(snapshots.map(({ status }) => status)).toEqual(["pending", "queued", "queued"]);
		await waitUntil(() => fixture.coordinator.get("first")?.status === "running");
		fixture.children[0]?.complete("first result");
		await waitUntil(
			() =>
				fixture.coordinator.get("first")?.status === "completed" &&
				fixture.coordinator.get("second")?.status === "running",
		);

		expect(fixture.coordinator.get("first")).toMatchObject({ status: "completed" });
		expect(fixture.coordinator.get("second")).toMatchObject({ status: "running" });
		expect(fixture.coordinator.get("third")).toMatchObject({ status: "queued" });
	});

	it("resolves id, task name and path to the same child", async () => {
		const fixture = createFixture();
		const snapshot = await fixture.coordinator.spawn(request("lookup"));

		expect(fixture.coordinator.get(snapshot.id)).toEqual(fixture.coordinator.get("lookup"));
		expect(fixture.coordinator.get("/root/lookup")).toEqual(fixture.coordinator.get("lookup"));
	});

	it("lets wait claim a generation before automatic notification", async () => {
		const onNotify = vi.fn();
		const onDeliveryClaimed = vi.fn();
		const fixture = createFixture({ onNotify, onDeliveryClaimed, notificationDelayMs: 10 });
		await fixture.coordinator.spawn(request("claimed"));
		fixture.children[0]?.complete("done");
		const result = await fixture.coordinator.wait({ targets: ["claimed"], timeoutMs: 1_000 });
		await delay(20);

		expect(result.agents).toEqual([expect.objectContaining({ taskName: "claimed", finalText: "done" })]);
		expect(onNotify).not.toHaveBeenCalled();
		expect(onDeliveryClaimed).toHaveBeenCalledWith({ id: "child-1", generation: 1 });
		expect((await fixture.coordinator.wait({ targets: ["claimed"] })).agents).toEqual([]);
	});

	it("emits terminal snapshots without model-facing tool protocol", async () => {
		const onNotify = vi.fn();
		const fixture = createFixture({ onNotify, notificationDelayMs: 1 });
		await fixture.coordinator.spawn(request("notified"));

		fixture.children[0]?.complete("done");
		await vi.waitFor(() => expect(onNotify).toHaveBeenCalledOnce());

		expect(onNotify).toHaveBeenCalledWith([
			expect.objectContaining({ taskName: "notified", status: "completed", finalText: "done" }),
		]);
		expect(await fixture.coordinator.wait({ targets: ["notified"] })).toEqual({ timedOut: false, agents: [] });
	});

	it("batches terminal notifications in completion order", async () => {
		const onNotify = vi.fn();
		const fixture = createFixture({ onNotify, notificationDelayMs: 5 });
		fixture.coordinator.spawnMany([request("first"), request("second")]);
		await waitUntil(() => fixture.children.length === 2);

		fixture.children[1]?.complete("second result");
		fixture.children[0]?.complete("first result");
		await vi.waitFor(() => expect(onNotify).toHaveBeenCalledOnce());

		expect(onNotify.mock.calls[0]?.[0].map(({ taskName }: SubagentSnapshot) => taskName)).toEqual([
			"second",
			"first",
		]);
	});

	it("restores terminal entries and deterministically normalizes abandoned work", async () => {
		const fixture = createFixture({ now: 500 });
		fixture.coordinator.restore({
			agents: [
				snapshot("completed", "completed", { generation: 2, sessionFile: "completed.conversation.jsonl" }),
				snapshot("running", "running", { generation: 4, sessionFile: "running.conversation.jsonl" }),
				snapshot("queued", "queued"),
			],
			delivered: [{ id: "completed", generation: 2 }],
		});

		expect(fixture.coordinator.get("completed")).toMatchObject({
			status: "completed",
			generation: 2,
		});
		expect(fixture.coordinator.get("running")).toMatchObject({
			status: "interrupted",
			generation: 5,
			endedAt: 500,
			errorMessage: "Parent runtime restarted while the subagent was active",
		});
		expect(fixture.coordinator.get("queued")).toMatchObject({
			status: "failed",
			generation: 1,
			endedAt: 500,
			errorMessage: "Parent runtime restarted before the child session was created",
		});
		expect((await fixture.coordinator.wait({ targets: ["completed"] })).agents).toEqual([]);
		expect((await fixture.coordinator.wait({ targets: ["running"] })).agents).toEqual([
			expect.objectContaining({ id: "running", status: "interrupted", generation: 5 }),
		]);
	});

	it("lazily reopens a recovered child for follow-up", async () => {
		const fixture = createFixture({ reopen: true });
		fixture.coordinator.restore({
			agents: [snapshot("recovered", "interrupted", { generation: 1, sessionFile: "recovered.conversation.jsonl" })],
			delivered: [],
		});

		const resumed = await fixture.coordinator.followUp("recovered", "continue the task");

		expect(resumed).toMatchObject({ id: "recovered", status: "running", task: "continue the task" });
		expect(fixture.children).toHaveLength(1);
		expect(fixture.children[0]?.prompts).toEqual(["continue the task"]);
	});

	it("marks a recovered child failed when its transcript cannot be reopened", async () => {
		const fixture = createFixture({ reopenError: new Error("transcript missing") });
		fixture.coordinator.restore({
			agents: [snapshot("missing", "interrupted", { generation: 1, sessionFile: "missing.conversation.jsonl" })],
			delivered: [],
		});

		await expect(fixture.coordinator.followUp("missing", "continue")).rejects.toThrow("transcript missing");
		expect(fixture.coordinator.get("missing")).toMatchObject({
			status: "failed",
			generation: 2,
			errorMessage: "Unable to reopen subagent: transcript missing",
		});
	});

	it("rejects an ambiguous recovered registry before mutating the coordinator", () => {
		const fixture = createFixture();

		expect(() =>
			fixture.coordinator.restore({
				agents: [snapshot("first", "completed"), { ...snapshot("second", "completed"), taskName: "first" }],
				delivered: [],
			}),
		).toThrow('Duplicate recovered subagent task_name "first"');
		expect(fixture.coordinator.list()).toEqual([]);
	});

	it("interrupts and resumes the same transcript through follow-up", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("resumable"));

		expect(fixture.coordinator.interrupt("resumable")).toMatchObject({
			status: "interrupted",
			generation: 1,
		});
		const resumed = await fixture.coordinator.followUp("resumable", "continue");

		expect(resumed).toMatchObject({ status: "running", task: "continue" });
		expect(fixture.children).toHaveLength(1);
		expect(fixture.children[0]?.prompts.at(-1)).toBe("continue");
	});

	it("keeps interrupted workflows when a new batch clears completed peers", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("completed", "workflow"));
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("completed")?.status === "completed");
		await fixture.coordinator.spawn(request("interrupted", "workflow"));
		fixture.coordinator.interrupt("interrupted");

		fixture.coordinator.spawnMany([request("new_scope", "workflow")]);

		expect(fixture.coordinator.get("completed")).toBeUndefined();
		expect(fixture.coordinator.get("interrupted")).toMatchObject({ status: "interrupted" });
		expect(fixture.coordinator.get("new_scope")).toBeDefined();
	});

	it("reuses a completed workflow name when the next batch replaces completed peers", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("same_scope", "workflow"));
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("same_scope")?.status === "completed");

		const [replacement] = fixture.coordinator.spawnMany([request("same_scope", "workflow")]);

		expect(replacement).toMatchObject({ taskName: "same_scope", agentType: "workflow" });
		expect(fixture.coordinator.list()).toHaveLength(1);
	});

	it("runs start and stop lifecycle policy around a successful child", async () => {
		const calls: string[] = [];
		const lifecycle: SubagentLifecycle = {
			async beforeStart() {
				calls.push("start");
				return { message: "policy: read-only\n\ninspect" };
			},
			async beforeStop() {
				calls.push("stop");
				return {};
			},
		};
		const fixture = createFixture({ lifecycle });

		await fixture.coordinator.spawn(request("lifecycle"));
		expect(fixture.children[0]?.prompts[0]).toContain("policy: read-only");
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("lifecycle")?.status === "completed");

		expect(calls).toEqual(["start", "stop"]);
	});

	it("caps stop lifecycle continuations without stranding the active slot", async () => {
		let stopCalls = 0;
		const fixture = createFixture({
			lifecycle: {
				async beforeStop() {
					stopCalls += 1;
					return { continuation: `continue-${stopCalls}` };
				},
			},
		});
		await fixture.coordinator.spawn(request("continuations"));
		await waitUntil(() => fixture.children[0]?.prompts.length === 1);

		for (let completion = 1; completion <= 9; completion += 1) {
			fixture.children[0]?.complete(`result-${completion}`);
			if (completion <= 8) await waitUntil(() => fixture.children[0]?.prompts.length === completion + 1);
		}
		await waitUntil(() => fixture.coordinator.get("continuations")?.status === "completed");

		expect(stopCalls).toBe(9);
		expect(fixture.children[0]?.prompts).toHaveLength(9);
	});

	it("fails and disposes the child when start lifecycle blocks", async () => {
		const fixture = createFixture({
			lifecycle: {
				async beforeStart() {
					return { blockedReason: "subagents disabled by policy" };
				},
			},
		});

		await expect(fixture.coordinator.spawn(request("blocked"))).rejects.toThrow("subagents disabled by policy");
		expect(fixture.coordinator.get("blocked")).toMatchObject({
			status: "failed",
			errorMessage: "subagents disabled by policy",
		});
		expect(fixture.children[0]?.disposeCalls).toBe(1);
	});

	it("mirrors todo progress and title into workflow snapshots", async () => {
		const fixture = createFixture();
		const [reserved] = fixture.coordinator.spawnMany([
			{ ...request("planned", "workflow"), title: "Refactor API", todos: ["inspect", "change"] },
		]);

		expect(reserved).toMatchObject({ title: "Refactor API", todoProgress: { done: 0, total: 2 } });
		await waitUntil(() => fixture.children.length === 1);
		fixture.children[0]?.updateTodoProgress({ done: 1, total: 2 });
		expect(fixture.coordinator.get("planned")).toMatchObject({
			title: "Refactor API",
			todoProgress: { done: 1, total: 2 },
		});
	});

	it("interrupts a queued workflow without starting it", async () => {
		const fixture = createFixture({ maxConcurrent: 1 });
		fixture.coordinator.spawnMany([request("first", "workflow"), request("second", "workflow")]);
		await waitUntil(() => fixture.coordinator.get("first")?.status === "running");

		expect(fixture.coordinator.interrupt("second")).toMatchObject({ status: "interrupted" });
		fixture.children[0]?.complete("done");
		await delay(10);
		expect(fixture.children).toHaveLength(1);
		expect(fixture.coordinator.get("second")).toMatchObject({ status: "interrupted" });
	});

	it("clears only terminal children and frees their task names", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("clearable"));
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("clearable")?.status === "completed");

		expect(fixture.coordinator.clearFinished()).toBe(1);
		expect(fixture.coordinator.list()).toEqual([]);
		await expect(fixture.coordinator.spawn(request("clearable"))).resolves.toMatchObject({ taskName: "clearable" });
	});

	it("owns a child factory result that resolves after shutdown starts", async () => {
		let createSignal: AbortSignal | undefined;
		let resolveCreate = (_child: SubagentChildHandle) => {};
		const created = new Promise<SubagentChildHandle>((resolve) => {
			resolveCreate = resolve;
		});
		const activeChild = new TestChild("active-child");
		const lateChild = new TestChild("late-child");
		const fixture = createFixture({
			maxConcurrent: 2,
			factory: {
				async create(spawnRequest, _type, signal) {
					if (spawnRequest.taskName === "active") return activeChild;
					createSignal = signal;
					return created;
				},
			},
		});
		await fixture.coordinator.spawn(request("active"));
		const spawning = fixture.coordinator.spawn(request("creating"));
		const firstDispose = fixture.coordinator.dispose();

		expect(fixture.coordinator.dispose()).toBe(firstDispose);
		expect(createSignal?.aborted).toBe(true);
		await waitUntil(() => activeChild.disposeCalls === 1);
		resolveCreate(lateChild);
		await expect(spawning).rejects.toThrow("Parent session disposed during subagent spawn");
		await firstDispose;
		expect(lateChild.disposeCalls).toBe(1);
	});

	it("owns a reopened child that resolves after shutdown starts", async () => {
		let reopenSignal: AbortSignal | undefined;
		let resolveReopen = (_child: SubagentChildHandle) => {};
		const reopened = new Promise<SubagentChildHandle>((resolve) => {
			resolveReopen = resolve;
		});
		const lateChild = new TestChild("late-reopened-child");
		const fixture = createFixture({
			factory: {
				async create() {
					return new TestChild("unused-child");
				},
				async reopen(_snapshot, _type, signal) {
					reopenSignal = signal;
					return reopened;
				},
			},
		});
		fixture.coordinator.restore({
			agents: [snapshot("recovered", "interrupted", { generation: 1, sessionFile: "recovered.jsonl" })],
			delivered: [],
		});

		const followingUp = fixture.coordinator.followUp("recovered", "continue");
		await waitUntil(() => reopenSignal !== undefined);
		const disposing = fixture.coordinator.dispose();
		expect(reopenSignal?.aborted).toBe(true);
		resolveReopen(lateChild);

		await expect(followingUp).rejects.toThrow("Parent session disposed during subagent reopen");
		await disposing;
		expect(lateChild.disposeCalls).toBe(1);
	});

	it("wakes active waiters with interrupted snapshots during shutdown", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("waiting"));
		const waiting = fixture.coordinator.wait({ targets: ["waiting"], timeoutMs: 5_000 });

		await fixture.coordinator.dispose();

		await expect(waiting).resolves.toEqual({
			timedOut: false,
			agents: [expect.objectContaining({ taskName: "waiting", status: "interrupted", generation: 1 })],
		});
	});
});

function createFixture(
	options: {
		readonly maxConcurrent?: number;
		readonly notificationDelayMs?: number;
		readonly onNotify?: (agents: readonly SubagentSnapshot[]) => void;
		readonly onDeliveryClaimed?: (marker: { readonly id: string; readonly generation: number }) => void;
		readonly now?: number;
		readonly reopen?: boolean;
		readonly reopenError?: Error;
		readonly lifecycle?: SubagentLifecycle;
		readonly factory?: SubagentChildFactory<TestProfile>;
	} = {},
) {
	const children: TestChild[] = [];
	let nextId = 0;
	const defaultFactory: SubagentChildFactory<TestProfile> = {
		async create() {
			nextId += 1;
			const child = new TestChild(`child-${nextId}`);
			children.push(child);
			return child;
		},
		async reopen(snapshot) {
			if (options.reopenError) throw options.reopenError;
			if (!options.reopen) throw new Error("reopen is disabled");
			const child = new TestChild(snapshot.id);
			children.push(child);
			return child;
		},
	};
	const factory = options.factory ?? defaultFactory;
	const registry = new SubagentTypeRegistry<TestProfile>().register(type("explorer")).register(type("workflow"));
	const coordinator = new SubagentCoordinator({
		factory,
		typeRegistry: registry,
		parentSessionId: "root-session",
		maxConcurrent: options.maxConcurrent,
		notificationDelayMs: options.notificationDelayMs,
		onNotify: options.onNotify,
		onDeliveryClaimed: options.onDeliveryClaimed,
		lifecycle: options.lifecycle,
		clock: options.now === undefined ? undefined : { now: () => options.now ?? 0 },
		idGenerator: { next: () => `reservation-${nextId + 1}` },
	});
	return { coordinator, children };
}

class TestChild implements SubagentChildHandle {
	readonly sessionFile: string;
	readonly prompts: string[] = [];
	disposeCalls = 0;
	private readonly listeners = new Set<(event: SubagentChildEvent) => void>();
	private readonly todoListeners = new Set<(progress: SubagentTodoProgress) => void>();
	private streaming = false;
	private finalText: string | undefined;
	private todoProgress: SubagentTodoProgress = { done: 0, total: 0 };
	private resolvePrompt: (() => void) | undefined;

	constructor(readonly sessionId: string) {
		this.sessionFile = `.subagents/${sessionId}.conversation.jsonl`;
	}

	async prompt(text: string): Promise<void> {
		this.prompts.push(text);
		this.streaming = true;
		this.emit({ type: "agent_start" });
		await new Promise<void>((resolve) => {
			this.resolvePrompt = resolve;
		});
	}

	async sendMessage(): Promise<void> {}

	async followUp(text: string): Promise<void> {
		await this.prompt(text);
	}

	abort(): void {
		this.streaming = false;
		this.resolvePrompt?.();
		this.resolvePrompt = undefined;
	}

	async waitForIdle(): Promise<void> {
		await waitUntil(() => !this.streaming);
	}

	isStreaming(): boolean {
		return this.streaming;
	}

	getLastAssistantText(): string | undefined {
		return this.finalText;
	}

	dispose(): void {
		this.disposeCalls += 1;
		this.abort();
		this.listeners.clear();
		this.todoListeners.clear();
	}

	subscribe(listener: (event: SubagentChildEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	complete(text: string): void {
		this.finalText = text;
		this.streaming = false;
		this.emit({ type: "agent_end" });
		this.resolvePrompt?.();
		this.resolvePrompt = undefined;
	}

	setTodos(contents: readonly string[]): void {
		this.updateTodoProgress({ done: 0, total: contents.length });
	}

	getTodoProgress(): SubagentTodoProgress {
		return { ...this.todoProgress };
	}

	subscribeTodos(listener: (progress: SubagentTodoProgress) => void): () => void {
		this.todoListeners.add(listener);
		return () => this.todoListeners.delete(listener);
	}

	updateTodoProgress(progress: SubagentTodoProgress): void {
		this.todoProgress = { ...progress };
		for (const listener of this.todoListeners) listener({ ...progress });
	}

	private emit(event: SubagentChildEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}

function request(taskName: string, agentType = "explorer"): SubagentSpawnRequest {
	return { taskName, agentType, message: `work on ${taskName}` };
}

function snapshot(
	id: string,
	status: SubagentSnapshot["status"],
	overrides: Partial<SubagentSnapshot> = {},
): SubagentSnapshot {
	const taskName = overrides.taskName ?? id;
	return {
		id,
		taskName,
		path: `/root/${taskName}`,
		agentType: "explorer",
		status,
		task: `work on ${taskName}`,
		parentSessionId: "root-session",
		startedAt: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
		generation: 0,
		...overrides,
	};
}

function type(kind: TestProfile["kind"]): SubagentTypeDefinition<TestProfile> {
	return {
		id: kind,
		label: kind,
		description: `${kind} agent`,
		profile: { kind },
	};
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await delay(1);
	}
	throw new Error("Condition was not reached");
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
