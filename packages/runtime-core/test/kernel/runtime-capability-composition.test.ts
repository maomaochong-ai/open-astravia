import { describe, expect, it } from "vitest";
import {
	type CompiledRuntimeSnapshot,
	PassthroughContextStrategy,
	type RuntimeCapabilityCompiler,
	RuntimeCapabilityComposition,
	type RuntimeCapabilityDefinition,
	type RuntimeSnapshot,
} from "../../src/kernel/index.js";

describe("RuntimeCapabilityComposition", () => {
	it("applies only the newest queued definition and disposes superseded generations", async () => {
		const disposed: string[] = [];
		let resolveFirst: ((compiled: CompiledRuntimeSnapshot) => void) | undefined;
		let markFirstStarted: (() => void) | undefined;
		const firstStarted = new Promise<void>((resolve) => {
			markFirstStarted = resolve;
		});
		const compiler: RuntimeCapabilityCompiler = {
			async compile(definition) {
				const id = definition.instructions[0]?.id ?? "unknown";
				if (id === "first") {
					markFirstStarted?.();
					return new Promise((resolve) => {
						resolveFirst = resolve;
					});
				}
				return compiledSnapshot(id, disposed);
			},
		};
		const composition = await RuntimeCapabilityComposition.create({
			initialDefinition: definition("initial"),
			compiler,
		});

		const first = composition.reconfigure(definition("first"));
		await firstStarted;
		const second = composition.reconfigure(definition("second"));
		resolveFirst?.(compiledSnapshot("first", disposed));

		await expect(first).resolves.toEqual({ status: "superseded" });
		await expect(second).resolves.toEqual({ status: "applied", snapshotId: "second" });
		const lease = await composition.acquire();
		expect(lease.snapshot.id).toBe("second");
		expect(disposed).toEqual(["first", "initial"]);
		await lease.release();
		await composition.close();
		expect(disposed).toEqual(["first", "initial", "second"]);
	});

	it("keeps the current definition after compilation failure and delays retirement until lease release", async () => {
		const disposed: string[] = [];
		const compiler: RuntimeCapabilityCompiler = {
			async compile(currentDefinition) {
				const id = currentDefinition.instructions[0]?.id ?? "unknown";
				if (id === "broken") throw new Error("compile failed");
				return compiledSnapshot(id, disposed);
			},
		};
		const composition = await RuntimeCapabilityComposition.create({
			initialDefinition: definition("initial"),
			compiler,
		});
		const activeLease = await composition.acquire();

		await expect(composition.reconfigure(definition("broken"))).rejects.toThrow("compile failed");
		await expect(composition.reconfigure(definition("next"))).resolves.toEqual({
			status: "applied",
			snapshotId: "next",
		});
		expect(activeLease.snapshot.id).toBe("initial");
		expect(disposed).toEqual([]);

		const nextLease = await composition.acquire();
		expect(nextLease.snapshot.id).toBe("next");
		await activeLease.release();
		expect(disposed).toEqual(["initial"]);
		await nextLease.release();
		await composition.close();
		expect(disposed).toEqual(["initial", "next"]);
	});
});

function definition(id: string): RuntimeCapabilityDefinition {
	return {
		instructions: [{ id, content: id, priority: 0 }],
		features: [],
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: {
			async authorize() {
				return true;
			},
		},
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
	};
}

function compiledSnapshot(id: string, disposed: string[]): CompiledRuntimeSnapshot {
	const snapshot: RuntimeSnapshot = {
		id,
		instructions: [],
		tools: new Map(),
		contextProviders: [],
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: {
			async authorize() {
				return true;
			},
		},
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
		observers: [],
	};
	return {
		snapshot,
		async dispose() {
			disposed.push(id);
		},
	};
}
