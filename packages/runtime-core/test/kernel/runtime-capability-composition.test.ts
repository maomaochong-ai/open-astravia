import { describe, expect, it } from "vitest";
import {
	type AgentProfile,
	type CompiledRuntimeSnapshot,
	PassthroughContextStrategy,
	RuntimeCapabilityComposition,
	type RuntimeProfileCompiler,
	type RuntimeSnapshot,
} from "../../src/kernel/index.js";

describe("RuntimeCapabilityComposition", () => {
	it("applies only the newest queued profile and disposes superseded generations", async () => {
		const disposed: string[] = [];
		let resolveFirst: ((compiled: CompiledRuntimeSnapshot) => void) | undefined;
		let markFirstStarted: (() => void) | undefined;
		const firstStarted = new Promise<void>((resolve) => {
			markFirstStarted = resolve;
		});
		const compiler: RuntimeProfileCompiler = {
			async compile(profile) {
				if (profile.id === "first") {
					markFirstStarted?.();
					return new Promise((resolve) => {
						resolveFirst = resolve;
					});
				}
				return compiledSnapshot(profile.id, disposed);
			},
		};
		const composition = await RuntimeCapabilityComposition.create({
			initialProfile: profile("initial"),
			compiler,
		});

		const first = composition.reconfigure(profile("first"));
		await firstStarted;
		const second = composition.reconfigure(profile("second"));
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

	it("keeps the current profile after compilation failure and delays retirement until lease release", async () => {
		const disposed: string[] = [];
		const compiler: RuntimeProfileCompiler = {
			async compile(currentProfile) {
				if (currentProfile.id === "broken") throw new Error("compile failed");
				return compiledSnapshot(currentProfile.id, disposed);
			},
		};
		const composition = await RuntimeCapabilityComposition.create({
			initialProfile: profile("initial"),
			compiler,
		});
		const activeLease = await composition.acquire();

		await expect(composition.reconfigure(profile("broken"))).rejects.toThrow("compile failed");
		await expect(composition.reconfigure(profile("next"))).resolves.toEqual({
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

function profile(id: string): AgentProfile {
	return {
		id,
		instructions: [],
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
