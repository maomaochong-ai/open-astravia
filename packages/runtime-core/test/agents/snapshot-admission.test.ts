import { describe, expect, it, vi } from "vitest";
import type { RuntimeAgentSnapshotAdmission } from "../../src/agents/index.js";
import { RUNTIME_AGENT_ERROR_CODES, RuntimeAgentRuntime } from "../../src/agents/index.js";
import type { RuntimeCapabilityDefinition, RuntimeSnapshotLease } from "../../src/kernel/index.js";
import { PassthroughContextStrategy } from "../../src/kernel/index.js";

describe("Agent snapshot admission transaction", () => {
	it.each(["bind", "commit"] as const)("rolls back %s failure and releases captured resources", async (failure) => {
		const release = vi.fn();
		const rollback = vi.fn();
		const commit = vi.fn(() => {
			if (failure === "commit") throw new Error("commit failed");
		});
		const runtime = createRuntime(() => ({ commit, rollback }), {
			...capabilities(),
			modelCallFrameComposer: {
				bindForTurn: () => {
					if (failure === "bind") throw new Error("bind failed");
					return { compose: async ({ frame }) => frame, releaseTurnBinding: release };
				},
				compose: async ({ frame }) => frame,
			},
		});
		try {
			const instance = await runtime.createInstance({ agentId: "agent" });
			const session = await instance.createSession({ sessionId: "session" });
			await expect(session.acquire(turn())).rejects.toThrow(`${failure} failed`);
			expect(rollback).toHaveBeenCalledWith(expect.objectContaining({ message: `${failure} failed` }));
			if (failure === "commit") expect(release).toHaveBeenCalledOnce();
			else expect(commit).not.toHaveBeenCalled();
		} finally {
			await runtime.close();
		}
	});

	it("serializes concurrent captures without locking their leases and closes admission before disposing", async () => {
		const gate = deferred<void>();
		const started = deferred<void>();
		const events: string[] = [];
		let count = 0;
		const runtime = createRuntime(async () => {
			const own = ++count;
			events.push(`prepare-${own}`);
			if (own === 1) {
				started.resolve();
				await gate.promise;
			}
			return {
				commit: () => {
					events.push(`commit-${own}`);
				},
				rollback: () => {
					events.push(`rollback-${own}`);
				},
			};
		});
		const instance = await runtime.createInstance({ agentId: "agent" });
		const session = await instance.createSession({ sessionId: "session" });
		const first = session.acquire(turn());
		await started.promise;
		const second = session.acquire(turn());
		expect(events).toEqual(["prepare-1"]);
		gate.resolve();
		const leases: RuntimeSnapshotLease[] = await Promise.all([first, second]);
		expect(events).toEqual(["prepare-1", "commit-1", "prepare-2", "commit-2"]);
		await Promise.all(leases.map((lease) => lease.release()));
		await runtime.close();
		await expect(session.acquire(turn())).rejects.toMatchObject({ code: RUNTIME_AGENT_ERROR_CODES.CLOSED });
	});
});

function createRuntime(
	beforeSnapshotAcquire: () => RuntimeAgentSnapshotAdmission | Promise<RuntimeAgentSnapshotAdmission>,
	definition = capabilities(),
) {
	const runtime = new RuntimeAgentRuntime();
	runtime.registry.upsert({
		source: { id: "test", revision: "1" },
		definition: {
			id: "agent",
			createInstance: () => ({
				prepareSession: () => ({ definition: { capabilities: definition }, beforeSnapshotAcquire }),
			}),
		},
	});
	return runtime;
}

function capabilities(): RuntimeCapabilityDefinition {
	return {
		instructions: [],
		features: [],
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: { authorize: async () => true },
		tokenBudget: 8000,
		reservedOutputTokens: 1000,
	};
}
function turn() {
	return { sessionId: "session", operationId: "turn", reason: "turn" as const, signal: new AbortController().signal };
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
