import { describe, expect, it } from "vitest";
import { BrowserSessionRegistry } from "./browser-session-registry.js";
import { BrowserAutomationError } from "./contracts.js";

describe("BrowserSessionRegistry", () => {
	it("serializes concurrent operations on the same session", async () => {
		const registry = new BrowserSessionRegistry();
		const order: number[] = [];
		const slow = async (value: number) => {
			order.push(value);
			await new Promise((r) => setTimeout(r, 20));
			order.push(value + 100);
			return value;
		};
		const results = await Promise.all([
			registry.runExclusive("ns", "s1", () => slow(1)),
			registry.runExclusive("ns", "s1", () => slow(2)),
		]);
		expect(results).toEqual([1, 2]);
		// strictly serialized: slow(1) before slow(2)
		expect(order.indexOf(101)).toBeLessThan(order.indexOf(2));
	});

	it("allows concurrent operations across different sessions", async () => {
		const registry = new BrowserSessionRegistry();
		let inFlight = 0;
		let maxInFlight = 0;
		const track = async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((r) => setTimeout(r, 10));
			inFlight -= 1;
		};
		await Promise.all([registry.runExclusive("ns", "s1", track), registry.runExclusive("ns", "s2", track)]);
		expect(maxInFlight).toBe(2);
	});

	it("rejects persistent profile held by another session", async () => {
		const registry = new BrowserSessionRegistry();
		await registry.runPersistentProfileExclusive("profile1", "ns", "s1", async () => {
			// holding
			await new Promise((r) => setTimeout(r, 10));
		});
		// lock released, s2 can proceed
		await registry.runPersistentProfileExclusive("profile1", "ns", "s2", async () => {
			// ok
		});
		// But concurrent:
		const p1 = registry.runPersistentProfileExclusive("profile2", "ns", "s1", async () => {
			await new Promise((r) => setTimeout(r, 30));
		});
		const p2 = registry.runPersistentProfileExclusive("profile2", "ns", "s2", async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		await Promise.allSettled([p1, p2]);
		// p2 should fail because p1 holds the lock
		await expect(p2).rejects.toBeInstanceOf(BrowserAutomationError);
		expect((await Promise.allSettled([p1])).at(0)?.status).toBe("fulfilled");
	});
});
