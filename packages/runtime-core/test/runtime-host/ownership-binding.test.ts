import { describe, expect, it } from "vitest";
import {
	RuntimeOwnershipBinding,
	type RuntimeOwnershipLease,
	type RuntimeOwnershipManager,
} from "../../src/runtime-host/ownership-binding.js";

describe("RuntimeOwnershipBinding", () => {
	it("acquires the target before releasing the source", async () => {
		const events: string[] = [];
		const binding = await RuntimeOwnershipBinding.acquire(manager(events), "source");

		await binding.rebind("target");
		await binding.dispose();

		expect(events).toEqual(["acquire:source", "acquire:target", "release:source", "release:target"]);
		expect(binding.target).toBe("target");
	});

	it("keeps source ownership when target acquisition fails", async () => {
		const events: string[] = [];
		const binding = await RuntimeOwnershipBinding.acquire(manager(events, "target"), "source");

		await expect(binding.rebind("target")).rejects.toThrow("target unavailable");
		expect(binding.target).toBe("source");
		await binding.dispose();

		expect(events).toEqual(["acquire:source", "acquire:target", "release:source"]);
	});

	it("releases the target when source release fails", async () => {
		const events: string[] = [];
		const binding = await RuntimeOwnershipBinding.acquire(
			{
				acquire: async (target) => ({
					release: async () => {
						events.push(`release:${target}`);
						if (target === "source") throw new Error("source release failed");
					},
				}),
			},
			"source",
		);

		await expect(binding.rebind("target")).rejects.toThrow("source release failed");
		expect(binding.target).toBe("source");
		expect(events).toEqual(["release:source", "release:target"]);
	});

	it("allows final cleanup to retry a transient release failure", async () => {
		let releaseAttempts = 0;
		const binding = await RuntimeOwnershipBinding.acquire(
			{
				acquire: async () => ({
					release: async () => {
						releaseAttempts++;
						if (releaseAttempts === 1) throw new Error("transient release failure");
					},
				}),
			},
			"source",
		);

		await expect(binding.dispose()).rejects.toThrow("transient release failure");
		await expect(binding.dispose()).resolves.toBeUndefined();
		expect(releaseAttempts).toBe(2);
	});
});

function manager(events: string[], rejectedTarget?: string): RuntimeOwnershipManager<string> {
	return {
		async acquire(target) {
			events.push(`acquire:${target}`);
			if (target === rejectedTarget) throw new Error(`${target} unavailable`);
			return lease(target, events);
		},
	};
}

function lease(target: string, events: string[]): RuntimeOwnershipLease {
	let released = false;
	return {
		async release() {
			if (released) return;
			released = true;
			events.push(`release:${target}`);
		},
	};
}
