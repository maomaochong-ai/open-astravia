import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialUpdaterApi } from "./plugin-official-updater.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialUpdaterApi", () => {
	it("routes every operation through the plugin capability session", async () => {
		const state = { phase: "idle", currentVersion: "1.0.0" };
		const updater = {
			getState: vi.fn().mockResolvedValue(state),
			getCurrentVersion: vi.fn().mockResolvedValue("1.0.0"),
			check: vi.fn().mockResolvedValue(state),
			download: vi.fn().mockResolvedValue(state),
			install: vi.fn().mockResolvedValue(undefined),
			dismiss: vi.fn().mockResolvedValue(undefined),
			cancel: vi.fn().mockResolvedValue(undefined),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { updater } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialUpdaterApi(assertOfficial, "capability-session");

		await expect(api.getState()).resolves.toEqual(state);
		await expect(api.getCurrentVersion()).resolves.toBe("1.0.0");
		await expect(api.check()).resolves.toEqual(state);
		await expect(api.download()).resolves.toEqual(state);
		await expect(api.install()).resolves.toBeUndefined();
		await expect(api.dismiss()).resolves.toBeUndefined();
		await expect(api.cancel()).resolves.toBeUndefined();

		expect(assertOfficial).toHaveBeenCalledTimes(7);
		for (const method of Object.values(updater)) {
			expect(method).toHaveBeenCalledWith("capability-session");
		}
	});
});
